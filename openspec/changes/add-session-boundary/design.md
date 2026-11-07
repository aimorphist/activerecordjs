# Design

## Entries

`src/index.ts` is the core entry. It stops re-exporting `connection.ts`. Three import paths:

| Entry | Owns |
|---|---|
| core (`src/index.ts`) | Model, query builder, associations, eager loader, collection proxies, `ConnectionScope`, `PgDatabase` session type |
| `postgres-js` | `createConnection`, `createPooledConnection`, and a scope over that pool |
| `node` | AsyncLocalStorage binding, `createActiveRecordJS`, `setGlobalConnection`, `runWithConnection` |

The PGlite entry is not created here. `add-pglite-adapter` adds it. Core does not import it.

Core reads the active scope through a reader the node entry installs when it loads. Core does not import `node:async_hooks`. A process-wide swap of the database object across an `await` is not that reader. The reader returns the scope stored for the current async context.

## Scope

`ConnectionScope` has `run(fn)`, `transaction(fn)`, and `close()`.

`transaction` on the postgres.js scope begins a driver transaction on the session that scope already holds, passes the callback a scope that carries the lease token, and commits or rolls back when the callback finishes, including hook awaits. That is ownership of one connection's transaction. It is not a process-wide queue. The single-session waiter queue, the token bypass of FIFO, and the 5 second timeout are how the PGlite adapter implements this same `transaction` method. They land in `add-pglite-adapter`, against the token this scope already carries.

Nested `transaction` throws. No flatten, no savepoint.

`close` rejects queued work and closes what that adapter owns. For postgres.js that is the client this scope opened.

A database call with no scope throws before any driver method. A missing scope does not wait.

`Model.query(fn)` passes `fn` the `PgDatabase` for the bound scope. The parameter type stops being `PostgresJsDatabase`.

## Call sites

These stop calling `getGlobalConnection()` and use the scope they were created with:

- `src/model.ts` (the `getGlobalConnection()` calls, including `Model.query` at line 604)
- `src/query-builder.ts` (`all` and `count`)
- `src/associations.ts`
- `src/eager-loader.ts`
- `src/collection-proxy.ts`
- `src/habtm-collection-proxy.ts`

Unit tests that call `setGlobalConnection` import it from the node entry. Their mock session still binds through that helper, so `User.find` in those tests keeps its current shape.

`src/setup.integration.ts` keeps swapping the global connection for each test transaction. This change updates its import only if the symbol moves. Removing that swap is `add-scope-harness`.

Raw `where` values still go through `sql.raw` in `query-builder.ts`. Bound `eq()` and `inArray` stay parameterized. This change does not rewrite the raw path.

## Check

A unit test or a small script walks the core entry's import graph and fails if it finds `node:`, `postgres`, or `@electric-sql/pglite`. `bun run test:unit` is the other gate. The Postgres integration suite is not a gate for this change.
