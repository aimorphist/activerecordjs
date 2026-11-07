---
title: ActiveRecordJS PGlite adapter
created: 2026-11-05
status: validated
scope_tier: mvp
---

# PRD: PGlite adapter and single-database access pool

## Problem Statement

ActiveRecordJS speaks only to networked Postgres through `postgres.js`. That driver, and `node:async_hooks`, are imported from the package root, so the library cannot load in a browser or in a WASM guest.

PGlite is Postgres compiled to WASM and run in single-user mode: one session, one execution stream. Callers will still be concurrent. A pool of databases would be a different product. The pool has to be a pool of waiters in front of one database.

The server shape Duke asked for is a process whose WASM engine is WASI on Wasmtime. The official PGlite client is an Emscripten build for JS hosts. A draft `libpglite` / `pglite-bindings` tree targets wasi32 and has been embedded with Wasmtime. ComponentizeJS can turn a JS bundle into a WASM component. Neither the binding nor that toolchain has been proven against this repository.

## User Personas

**Library maintainer.** Wants one Model API on more than one driver, and a package that can be imported where Node does not exist.

**Application developer on Node.** Already uses `createActiveRecordJS` against networked Postgres. Wants that path to keep working, including the Rails-shaped `User.find` call.

**Embedded-database developer.** Wants the same models against PGlite in the browser, Bun, or Node, with no Postgres install. Persistence is memory, IndexedDB, or a directory, depending on the host.

**Server operator.** Wants a Linux process that is Wasmtime, not a Node server that happens to load a WASM file. That process owns one database and serves concurrent callers.

## User Journeys

**Node app stays on Postgres.** The developer imports the postgres.js entry, calls `createActiveRecordJS(db)`, and runs the existing integration tests. Nothing in that import pulls in PGlite.

**Browser script uses PGlite.** The developer imports the PGlite entry and the core. The import graph has no `node:` and no `postgres`. They open a scope, run `User.create` and `User.where`, and close it. Two overlapping calls do not interleave SQL on the one session. A transaction holds the session until commit or rollback, including awaits inside hooks.

**Server process on Wasmtime.** This journey is the milestone after MVP, and it starts only after the spike below passes. A native host starts Wasmtime. One owner thread runs one WASI Postgres instance against one data directory. A bounded pool of caller threads submits SQL and parameters. A transaction token skips the queue so the holder is not stuck behind the next transaction. After a crash, reopening the same directory shows committed data and does not show rolled-back data.

## Success Metrics

- The existing postgres.js integration suite still passes on `main` after the split.
- The same CRUD, validation, and association examples pass against in-memory PGlite. Count: the current unit tests (128) stay green, and a new PGlite integration file covers create, find, update, destroy, a transaction rollback, and one association load.
- A static check fails the build if `src/core` (the name can change; the rule cannot) imports `node:`, `postgres`, or `@electric-sql/pglite`.
- Two overlapping PGlite transactions: the second begins only after the first commits or rolls back. A lease that is never released fails within 5 seconds, rolls back, and raises an error that names the lease.
- Wasmtime spike, before that milestone is scheduled as build work: one `eq()`-bound Model query, one rollback, process exit, reopen the data directory, and the committed row is present and the rolled-back row is absent. Pass or fail is written into this plan. A fail leaves the milestone unscheduled.

## Functional Requirements

FR1. [MVP] The system shall keep the networked Postgres adapter on `postgres.js` and `drizzle-orm/postgres-js`, with the current pool options.

FR2. [MVP] The system shall provide a PGlite adapter on `@electric-sql/pglite` and `drizzle-orm/pglite` for JS hosts (browser, Node, Bun).

FR3. [MVP] The system shall split entry points so the core, the postgres.js adapter, the PGlite adapter, and the Node AsyncLocalStorage helper can be imported separately. The package root shall not import `node:` or `postgres`.

FR4. [MVP] The system shall type the shared session as Drizzle's common Postgres database surface (`PgDatabase`), not as `PostgresJsDatabase`.

FR5. [MVP] The system shall expose an explicit connection scope. `scope.run(fn)` provides the session. `scope.transaction(fn)` holds exclusive ownership from BEGIN until COMMIT or ROLLBACK, including awaits inside the callback and inside hooks.

FR6. [MVP] The system shall keep a Node helper that binds the active scope with AsyncLocalStorage so existing `User.find` call sites keep working on Node.

FR7. [MVP] The system shall require a scope-bound Model on runtimes without that helper. A call that needs a database and has no scope shall throw before it touches the database.

FR8. [MVP] The system shall grant one exclusive lease on the single PGlite session. A second transaction waits. Autocommit work waits while a lease is held. Work that carries the active lease token runs. A strictly FIFO queue shall not be the only rule.

FR9. [MVP] The system shall bound lease wait. Default timeout is 5 seconds. On timeout the system rolls back the leased transaction if one is open, releases the lease, and raises an error that names the timeout.

FR10. [MVP] The system shall make `scope.transaction()` the transaction API on every adapter. `Model.query` may still run a callback with the session. `session.transaction()` shall work on postgres.js and on PGlite. The Wasmtime transport shall not be Drizzle's `pg-proxy` session, because that session throws on `transaction()`.

FR11. [MVP] The system shall reject nested `scope.transaction()` calls with an error. It shall not flatten them into the outer transaction and it shall not open a savepoint.

FR12. [MVP] The system shall allow session-level Postgres state (`SET`, temp tables, advisory locks) only as `SET LOCAL` inside a lease, and shall reject other session-level state changes on the PGlite adapter.

FR13. [MVP] The system shall move the integration harness off swapping the global connection. PGlite tests take a scope and run one leased transaction at a time. Postgres.js tests may stay parallel.

FR14. [MVP] The system shall ship a feasibility spike for the Wasmtime process: a native host, one WASI Postgres instance, one owner thread, a bound-parameter query, a rollback, and a reopen of the same data directory. The spike record is a pass/fail note in this file. Result 2026-11-07: go. `docs/spikes/wasmtime-reopen/finding.md`. Artifact: draft `pglite-bindings` at `0d31326`, Wasmtime 38.0.3, PostgreSQL 16.6. A host SQL boundary met the sequence, so the ORM stays out of the guest for that shape.

FR15. [Growth] The system shall ship the server process as Wasmtime plus WASI: one database owner thread, a bounded pool of caller threads, SQL and parameters as the only database crossing, and one preopened data directory.

FR16. [Growth] The system shall run that process without Node in the server path. The ORM enters the guest only if the spike shows the SQL import cannot be hosted any other way that still satisfies FR15.

FR17. [Vision] The system shall support savepoints as the AR7 nested-transaction feature, on every adapter that can express them.

FR18. [Vision] The system shall isolate PGlite test workers with separate database instances. That is a test feature, not the access pool.

## Non-Functional Requirements

NFR1. [Portability] The core module's import graph contains no `node:` builtins, no `postgres`, and no `@electric-sql/pglite`.

NFR2. [Concurrency] PGlite executes one SQL statement at a time. The waiter pool does not start a second statement on that instance.

NFR3. [Latency] A lease timeout fires within 5 seconds of the configured deadline, measured in the PGlite integration test.

NFR4. [Durability] The Wasmtime spike treats a committed row as durable across process exit, and a rolled-back row as absent after reopen. MVP JS-host PGlite durability matches the data directory or IndexedDB mode the test opens.

NFR5. [Compatibility] The postgres.js integration suite on `main` passes after the entry-point split.

## Scope Boundaries

### In Scope

- Entry-point split and a Node-free core.
- PGlite adapter on JS hosts, with an exclusive lease and `scope.transaction()`.
- postgres.js adapter kept.
- A recorded Wasmtime spike (FR14).
- Test harness moved onto scopes.

### Out of Scope

- Electric sync, pgvector, live queries.
- Replacing Drizzle.
- A pool of databases, or one PGlite instance per worker, as the product.
- Savepoints (FR17) and per-worker PGlite instances for tests (FR18).
- Shipping the Wasmtime server (FR15, FR16) inside MVP. The spike is in MVP. The server is the next milestone, and only if the spike passes.
- A Node process whose only job is to embed Wasmtime under the official PGlite client. JS hosts already run that WASM.

## MVP / Growth / Vision Tiers

### MVP

FR1 postgres.js stays. FR2 PGlite on JS hosts. FR3 split entries. FR4 `PgDatabase`. FR5 explicit scope and transaction. FR6 Node AsyncLocalStorage helper. FR7 missing scope throws. FR8 exclusive lease and token bypass. FR9 5 second timeout with rollback. FR10 one transaction API, no pg-proxy on the WASM transport. FR11 nested transactions throw. FR12 session state only via `SET LOCAL`. FR13 tests use scopes. FR14 Wasmtime spike recorded.

### Growth

FR15 Wasmtime server process with one owner thread and a waiter pool. FR16 that process does not require Node. The ORM becomes a guest only if the spike says the host SQL import is not enough.

### Vision

FR17 savepoints. FR18 separate PGlite instances for test isolation.

## Constraints

- PGlite 0.5 is one Postgres session. Connection multiplexing shares that session. It does not execute queries in parallel.
- `drizzle-orm` 0.44 `pg-proxy` throws from `transaction()`. A custom session, the same idea as `drizzle-orm/pglite`, is the WASM transport if Drizzle stays.
- Wasmtime: one database `Store`, owned by one thread. Caller threads wait. They do not call into that store themselves.
- `libpglite` / `pglite-bindings` is draft (overflow and exception handling called out as incomplete by that tree).
- ComponentizeJS is a real toolchain. This repository has not been built with it.
- AR7 in `docs/PRD.md` still lists nested transactions and savepoints as unfinished. This plan does not implement AR7. Nested `scope.transaction()` throws until AR7.
- `docs/PRD.md` says "Connection pooling — Drizzle handles this." That sentence is about networked Postgres. It does not describe PGlite. The single-session lease is this adapter's pool.

## Assumptions & Risks

- PGlite's own client already serializes statements. The lease is still ours, because transaction ownership and hook awaits are above the driver. If PGlite does not serialize, the lease also becomes the statement queue. Verify during FR8.
- The draft WASI binding may not be buildable. FR14 exists so that failure is a recorded spike result, and FR15 stays unscheduled.
- Putting the ORM inside the guest (ComponentizeJS) may be required for a no-Node server. It may also be unnecessary if the host can run SQL against WASI Postgres and a later guest is only the application. FR16 picks that up from the spike.
- A missed scope on a non-Node runtime deadlocks if it waits on a lease the caller already holds. FR7 throws before any wait, and FR9 bounds every wait.
- Parameter encoding (timestamps, numerics, bytea, arrays) can diverge between postgres.js and PGlite. The integration file should include one of each of those four types.
- `query-builder.ts` interpolates some `where` values through `sql.raw`. The spike and the PGlite tests must go through bound parameters (`eq()` or the driver placeholder path). A string-interpolated query does not prove the boundary.

## Open Questions

- Which WASI artifact does FR14 link: draft `pglite-bindings`, or a Postgres WASI build we produce ourselves? The spike chooses and writes the choice down.
- Does the Node helper stay a supported public entry, or become an internal default when `detectRuntime()` sees Node? MVP keeps it as an explicit `/node` entry so the core stays pure.
- IndexedDB versus memory as the browser default. MVP tests use memory. A directory is the Node PGlite persistence check.

## Existing System Context

`src/connection.ts` stores a `PostgresJsDatabase`, reads `AsyncLocalStorage`, and opens `postgres` pools. `createActiveRecordJS` writes that global and returns one shared Model factory (`src/model.ts`). `Model.query`, the query builder, associations, collection proxies, and the HABTM proxy all call `getGlobalConnection()`. Integration setup swaps that global around each test (`src/setup.integration.ts`).

Drizzle already ships `drizzle-orm/pglite`. `PgliteDatabase` extends `PgDatabase`. It is not a `PostgresJsDatabase`.

## Architecture pin

Agreed by the author after an Astra sketch and an Opus review. Both readers returned caution. The pin is:

One database. One owner. A pool of waiters. An explicit scope. `PgDatabase` as the shared type. postgres.js unchanged in role. PGlite via the official client on JS hosts. Node keeps AsyncLocalStorage as a separate entry so `User.find` still works there. Browser and any future guest use a scope-bound Model.

The Wasmtime process is specified now and built second. MVP includes the spike that decides whether that process is a host plus one WASI database, or a WASM guest that contains the ORM. MVP does not include ComponentizeJS as a dependency of the adapter. MVP does not include a Node wrapper around Wasmtime.

Reviews: Astra (`astra-plan`, caution) argued for ComponentizeJS inside the first cut so "fully WASM-runnable" could not be watered down. Opus (`opus-arch-review`, caution) refused three runtimes in one MVP and refused the middle design where Node hosts Wasmtime only to reach WASM that PGlite already loads. The author took Opus on the cut line and Astra on the rule that the server, when it exists, is Wasmtime with one owner thread.

## Validation

Status `validated` after the two architecture reads. No separate critic pass. The PRD skill's interview was skipped because the request already named the database, the pool, the runtime, and the review order.
