# Design

## Entries

`src/index.ts` is the core entry. It stops re-exporting `connection.ts`. Three import paths:

| Entry | Owns |
|---|---|
| core (`src/index.ts`) | Model, query builder, associations, eager loader, collection proxies, `ConnectionScope`, `PgDatabase` session type |
| `postgres-js` | `createConnection`, `createPooledConnection`, and a scope over that pool |
| `node` | AsyncLocalStorage binding, `createActiveRecordJS`, `setGlobalConnection`, `runWithConnection` |

The PGlite entry is not created here. `add-pglite-adapter` adds it. Core does not import it.

Core holds no session. An unbound static call reads a reader the node entry installs when it loads. Core does not import `node:async_hooks`. The reader returns the AsyncLocalStorage store for the current context, otherwise the node entry's default scope. A captured scope on a model, builder, instance, or association does not consult that reader.

## Binding

`scope.model(table)` returns a model class closed over that scope. That is the core-only path. A browser caller loads core, opens a postgres.js or later PGlite scope, and calls `find` on `scope.model(table)`. No node entry is loaded.

`scope.run(fn)` calls `fn` with the scope. It does not retarget a model already bound to another scope.

On Node, `createActiveRecordJS(db)` stores a default scope in the node entry and returns the factory. Unbound `User.find` uses the AsyncLocalStorage store when one is set, and otherwise that default. `setGlobalConnection(db)` replaces the node default for tests. It does not write a session into core. `runWithConnection(db, fn)` sets the store for `fn` and restores the previous store, including the default, when `fn` returns. Two concurrent Node contexts therefore see two stores.

Captured scope wins over both the store and the node default. Hooks and belongs-to loads use the scope on the owner. Inside `transaction` that is the callback scope, so the related `find` runs on the transaction session.

## Scope

`ConnectionScope` has `run(fn)`, `transaction(fn)`, `close()`, and `model(table)`.

`transaction` on the postgres.js scope begins a driver transaction on the connection that scope already holds. The callback receives a child scope whose session is the driver's transaction session and whose lease token is live across hook awaits. Commit, rollback, and a failure of completion itself all retire that token. This is ownership of one connection's transaction. It is not a process-wide queue. The single-session waiter queue, the token bypass of FIFO, and the 5 second timeout are how the PGlite adapter implements this same `transaction` method. They land in `add-pglite-adapter`.

`transaction` on the callback scope throws. `transaction` on the same root, while its callback is in progress, throws. A different root scope may enter `transaction` at the same time. The postgres.js pool stays a pool. No flatten, no savepoint.

After the token retires, the child scope and any builder created from it throw before a driver method. `close` on the child rejects further child work and leaves the root client open. `close` on the root during a callback rolls the transaction back, retires the token, and closes the client that root owns.

A database call with no captured scope and no node ambient scope throws before any driver method. A missing scope does not wait.

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

A unit test walks the published core subpath, follows static imports and dynamic `import()`, and fails if it finds `node:`, `postgres`, or `@electric-sql/pglite`. The same test loads the `postgres-js` and `node` subpaths as separate entries. `bun run test:unit` is the other gate. The Postgres integration suite is not a gate for this change.

The fake-session tests for scope A versus B, concurrent Node contexts, nested receivers, token retirement, and close ownership are the tasks named in the 2026-11-06 review.
