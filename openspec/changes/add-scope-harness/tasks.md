# Tasks

- [x] Replace `beginTestTransaction` / `setGlobalConnection` with a per-test scope on its own postgres.js connection. The test body and its hooks see that scope. The scope rolls back when the test ends.
- [x] `src/setup.integration.ts` does not call `setGlobalConnection`.
- [x] Postgres integration tests that called `getGlobalConnection` use the test scope instead.
- [x] `bun run test:integration` passes against Postgres. Tests in one file stay isolated from each other, and files may still run in parallel.
- [x] `bun run test:unit` and `bun run test:pglite` still pass.
