# add-pglite-adapter

> **ACTIVE BUILD**

**Rigor:** change

## Why

The session boundary is a `ConnectionScope` over a `PgDatabase`. postgres.js uses that scope as a pool of real connections. PGlite is one WASM Postgres session. A second caller has to wait on that session, and the wait has to end.

## What

- Add the `pglite-adapter` capability: a `./pglite` entry that opens one official PGlite database and hands callers a scope.
- Give that one session an exclusive lease. A transaction holds it from begin through commit or rollback, including hook awaits. Autocommit waits while the lease is held. Work that carries the live lease token does not wait behind the next caller.
- Bound the wait at 5 seconds. On timeout, roll back the open transaction, release the lease, and raise an error that names the timeout.

## Impact

- Capabilities: ADDED `pglite-adapter`
- ADRs: none. `ARCHITECTURE.md` already places this adapter on the single-session lease. This change does not amend that shape.

## User journey & surfaces

No new UI because this is a library adapter, not a product screen. The outcome reaches callers of the `pglite` entry, and `bun run test:pglite`.

## Out of scope

- Moving `src/setup.integration.ts` off the global connection swap. Tracked as `add-scope-harness`.
- The Wasmtime process and `spike-wasmtime-reopen`.
- Savepoints. Tracked as AR7 in `docs/PRD.md`.
- Electric sync, pgvector, and one PGlite database per test worker.
