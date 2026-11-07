# add-scope-harness

> **ACTIVE BUILD**

**Rigor:** change

## Why

`src/setup.integration.ts` still points every Postgres test at a connection by calling `setGlobalConnection`. The session boundary already gives each call a scope. The Postgres suite has to use that, and it has to keep running tests in parallel.

## What

- Add the `test-scopes` capability. The Postgres integration harness binds a scope for each test and rolls that test's transaction back.
- `setup.integration.ts` stops calling `setGlobalConnection`.
- Each Postgres test keeps its own connection, so the suite stays parallel. The PGlite suite is unchanged.

## Impact

- Capabilities: ADDED `test-scopes`
- ADRs: none. `ARCHITECTURE.md` already says the harness moves onto scopes.

## User journey & surfaces

No new UI because this is the test harness. The outcome reaches `bun run test:integration`.

## Out of scope

- The PGlite lease and `bun run test:pglite`. Already landed as `pglite-adapter`.
- The Wasmtime process and `spike-wasmtime-reopen`.
- Savepoints. Tracked as AR7 in `docs/PRD.md`.
