# Tasks

- [x] Split package entries into core, `postgres-js`, and `node`. The core entry's import graph contains no `node:` builtin, no `postgres`, and no `@electric-sql/pglite`.
- [x] Type the shared session as Drizzle `PgDatabase`. `Model.query` takes that surface.
- [x] Add `ConnectionScope` with `run(fn)`, `transaction(fn)`, `close()`, and `model(table)`. `transaction` begins, passes a callback scope that carries the lease token and uses the driver's transaction session through the callback and its hook awaits, then commits or rolls back and retires the token.
- [x] `transaction` throws on the callback scope and on the same root while that transaction is open. A different root may enter `transaction` at the same time. No flatten, no savepoint.
- [x] A call that needs a database and has no scope throws before it touches the database.
- [x] The node entry binds the active scope with AsyncLocalStorage. `createActiveRecordJS` lives on that entry. With a scope bound, `User.find` still takes no scope argument.
- [x] Move Model, the query builder, associations, the eager loader, and both collection proxies off `getGlobalConnection()` onto the scope they were created with.
- [x] Point unit tests that bind a connection at the node entry. `bun run test:unit` passes.
- [x] Add a check that fails if the core entry imports `node:`, `postgres`, or `@electric-sql/pglite`, including dynamic `import()` specifiers. The check loads the published core, `postgres-js`, and `node` subpaths.
- [x] Leave `src/setup.integration.ts` swapping the global connection. Change only the import path if the move requires it.
- [x] Advise R1: Pin core-only Model/scope binding, transaction-bound hook and association usage, explicit/ambient precedence, and Node helper binding lifetime; add the A/B retention, concurrent-context, and missing-scope scenarios requested in reviews/2026-11-06-advise.md.
- [x] Advise R2: Reconcile nested-transaction receiver semantics for callback scopes, retained root scopes, and independent concurrent postgres.js work; align the spec, examples, and focused tests.
- [x] Advise R3: Pin transaction-session selection, token retirement on success and failure, escaped child-scope behavior, and root/child close ownership including active work; add focused fake-session lifecycle tests.
