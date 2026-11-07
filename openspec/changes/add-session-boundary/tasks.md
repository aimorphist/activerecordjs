# Tasks

- [ ] Split package entries into core, `postgres-js`, and `node`. The core entry's import graph contains no `node:` builtin, no `postgres`, and no `@electric-sql/pglite`.
- [ ] Type the shared session as Drizzle `PgDatabase`. `Model.query` takes that surface.
- [ ] Add `ConnectionScope` with `run(fn)`, `transaction(fn)`, and `close()`. `transaction` begins, passes a scope that carries the lease token through the callback and its hook awaits, then commits or rolls back.
- [ ] Nested `scope.transaction()` throws. It does not flatten into the outer transaction and it does not open a savepoint.
- [ ] A call that needs a database and has no scope throws before it touches the database.
- [ ] The node entry binds the active scope with AsyncLocalStorage. `createActiveRecordJS` lives on that entry. With a scope bound, `User.find` still takes no scope argument.
- [ ] Move Model, the query builder, associations, the eager loader, and both collection proxies off `getGlobalConnection()` onto the scope they were created with.
- [ ] Point unit tests that bind a connection at the node entry. `bun run test:unit` passes.
- [ ] Add a check that fails if the core entry imports `node:`, `postgres`, or `@electric-sql/pglite`.
- [ ] Leave `src/setup.integration.ts` swapping the global connection. Change only the import path if the move requires it.
