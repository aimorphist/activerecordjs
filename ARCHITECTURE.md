# Architecture

ActiveRecordJS keeps one Model API and gains a second database. Networked Postgres stays on `postgres.js`. PGlite is a single Postgres session in WASM. Concurrent callers wait on that one session. They do not each get a database.

The server process, when it exists, is Wasmtime running WASI. That process is not part of the first landing. A spike has to show that one WASI Postgres can run a bound query, roll it back, and still have the committed row after the process starts again.

## Shape

```text
Model / QueryBuilder / associations
        |
        |  explicit ConnectionScope
        v
   PgSession  (Drizzle PgDatabase, not a driver type)
        |
        +-- postgres.js adapter ---- TCP pool ---- networked Postgres
        |
        +-- PGlite adapter ---- exclusive lease ---- one PGlite session
        |                                              |
        |                                              +-- Emscripten Postgres WASM
        |
        +-- (later) Wasmtime host
              waiter threads
                    |
                    v
              one owner thread
                    |
                    v
              one WASI Postgres, one data directory
```

Node keeps a separate helper. That helper stores the active scope in `AsyncLocalStorage`, which is what lets `User.find` stay unchanged on Node. Browser code and any future guest call a scope-bound Model. A call with no scope throws before it touches a database.

The core entry is package export `.` (`src/index.ts`). It imports neither a `node:` builtin, nor `postgres`, nor `@electric-sql/pglite`. `./postgres-js` owns the postgres.js client. `./pglite` owns the PGlite client and opens it with `openPglite`. `./node` owns the AsyncLocalStorage binding.

| Entry | Export | Holds |
|---|---|---|
| core | `.` | Model, query builder, associations, `ConnectionScope`, `LeaseToken`, `PgSession` |
| `postgres-js` | `./postgres-js` | `createConnection`, `createPooledConnection` |
| `pglite` | `./pglite` | `openPglite`: one PGlite database and the lease |
| `node` | `./node` | AsyncLocalStorage binding for the active scope |

`createActiveRecordJS(db)` stays on the Node entry. It binds the scope and returns the Model factory. Other hosts open a scope and run work inside it.

## Session

`PgSession` is the shared Drizzle Postgres surface: `select`, `insert`, `update`, `delete`, `execute`, and `transaction`. Driver clients stay inside adapters. `Model.query` takes that surface, not `PostgresJsDatabase`.

`ConnectionScope` has four operations:

- `run(fn)` invokes `fn` with that scope.
- `transaction(fn)` begins, runs `fn` with a callback scope that carries a `LeaseToken` and uses the driver's transaction session, then commits or rolls back and retires the token. The exclusive lease and its waiter are the PGlite adapter's job, described under Lease. They are not how the postgres.js scope works.
- `close()` rejects further work on the scope it is called on. On a root it also rolls back an open transaction and closes the client that root owns. On a callback scope it leaves the root client open.
- `model(table)` returns a model class bound to that scope. That is how a core-only caller finds a row.

Query builders, model instances, and association lookups keep the scope they were created with. A hook that runs during a transaction uses that same scope. The implementation does not swap a global connection across an `await`. The integration harness in `src/setup.integration.ts` still swaps the node default around each test. The callers in `model.ts`, `query-builder.ts`, `associations.ts`, and the collection proxies are already on the scope they were created with.

Nested `transaction()` throws. It does not flatten into the outer transaction, and it does not open a savepoint. Savepoints stay with AR7 in `docs/PRD.md`.

On the PGlite adapter, session state that would leak across callers is rejected. `SET LOCAL` inside a lease is allowed. `SET`, temp tables, and advisory locks are not.

## Lease

PGlite 0.5 runs Postgres in single-user mode. Multiplexed client connections share that one session. They do not run SQL in parallel.

One lease owns the session:

- A transaction holds it from `BEGIN` through `COMMIT` or `ROLLBACK`, including time spent awaiting hooks.
- The second transaction waits.
- Autocommit work waits while the lease is held.
- Work that carries the lease token runs. A FIFO queue alone would deadlock the holder behind the next waiter.
- The wait is bounded at 5 seconds. On timeout the open transaction rolls back, the lease is released, and the error names the timeout.

PGlite 0.5 already serializes statements. That queue has no timeout and no holder token. This lease is the transaction owner. It is not a second statement queue.

`drizzle-orm` `pg-proxy` throws from `transaction()`. The Wasmtime path does not use that session. A small Drizzle session, the same kind `drizzle-orm/pglite` already is, owns `BEGIN` and `COMMIT` on every adapter. `scope.transaction()` is the API. Raw `session.transaction()` works on postgres.js and on PGlite.

Some `where` values in `query-builder.ts` are interpolated through `sql.raw`. A query built that way does not prove that parameters cross a boundary. Tests and the Wasmtime spike go through bound parameters.

## Runtimes

**postgres.js.** Unchanged in role. The pool stays a pool of real Postgres connections. Parallel tests on that adapter stay parallel.

**PGlite on a JS host.** Browser, Node, or Bun. The official `@electric-sql/pglite` client and `drizzle-orm/pglite`. Persistence is memory, IndexedDB, or a directory, matching the host. Tests use memory. One directory reopen check covers Node.

**Wasmtime process.** Not in the first landing. A native host. One database `Store` on one owner thread. Caller threads block on a bounded queue and submit SQL text plus parameters. The only database crossing is that pair, the rows, the error, and the lease token. One preopened data directory. The process does not run on Node.

A Node process that embeds Wasmtime only to reach WASM which the official PGlite client already loads is not a runtime we are building.

Whether the ORM itself is inside the WASM guest is decided by the spike. The guest is the ORM only if a host SQL import cannot meet the process shape above.

## Spike

No synthesis file exists for this. The claim is unverified.

`wasmtime-reopen`: one WASI Postgres under Wasmtime can execute one bound-parameter statement, roll a second statement back, exit, and after a new process opens the same directory show the committed row and not the rolled-back row.

Confidence is low. The draft `pglite-bindings` tree documents incomplete overflow and exception handling, and this repository has never been built with ComponentizeJS. Verification is to run that sequence and record pass or fail. Until that record exists, the Wasmtime host is not scheduled as build work.

## Out of this shape

Electric sync, pgvector, live queries, replacing Drizzle, one database per worker, and savepoints. A pool of databases is a different product from this lease.

The product requirements and the tier cut live in `docs/plans/2026-11-05-pglite-adapter.md`.
