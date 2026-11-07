# Design

`beforeEach` cannot wrap the test body in AsyncLocalStorage. The store set there does not survive into the test function. That is why the harness used to call `setGlobalConnection` for the synchronous part of the test.

Vitest fixtures can wrap the body. The harness exports a `test` extended with a `scope` fixture:

- The fixture opens one postgres.js connection (`max: 1`) and a root `ConnectionScope` from `createPostgresJsScope` or `scopeFromPostgresClient`.
- It enters `scope.transaction`, passes the callback scope to the test, and rolls that transaction back when the fixture finishes. A throw from the test is still a rollback.
- The callback scope is installed with `runWithConnection` for the body of `use()`, so unbound `User.find` inside the test reads it. The fixture does not call `setGlobalConnection`.
- `setupTestDb` still creates tables' pool only if a file needs a connection outside a test. It returns a scope. It does not install a process default.

`src/habtm.integration.test.ts` currently reads `getGlobalConnection()`. It takes the fixture scope instead.

Files keep Vitest's file parallelism. Each test holds a different connection, so one file's transaction does not take the lease of another file. The PGlite suite is not part of this harness.

`bun run test:integration` is the gate. It needs Postgres on `localhost:5433` as `docker-compose.yml` defines it. Unit tests and `test:pglite` stay green and do not need that database.
