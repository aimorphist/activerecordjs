# add-session-boundary

> **ACTIVE BUILD**

**Rigor:** architecture

## Why

Model, the query builder, and the association helpers all read one process-wide `PostgresJsDatabase` through `getGlobalConnection()`. That helper imports `node:async_hooks` and `postgres`, and `src/index.ts` re-exports it, so the package root cannot load in a browser or a guest. A second database needs a session type and a scope that those callers keep, with Node's ambient binding kept on its own entry.

## What

- Add the `session-boundary` capability: a `PgDatabase` session, an explicit `ConnectionScope`, and separate core, `postgres-js`, and `node` entries.
- Move Model, query builder, associations, eager loading, and collection proxies onto the scope they were created with.
- Keep `User.find` working on Node by binding the active scope with AsyncLocalStorage in the node entry.

## Impact

- Capabilities: ADDED `session-boundary`
- ADRs: none. `ARCHITECTURE.md` already records this shape. This change does not amend it.

## User journey & surfaces

No new UI because this is a library seam, not a product screen. The outcome reaches Model and QueryBuilder callers, and `bun run test:unit`.

## Out of scope

- The PGlite client, `drizzle-orm/pglite`, the single-session waiter queue, the 5 second lease timeout, and `SET LOCAL` rules. Tracked as `add-pglite-adapter`.
- Stopping `src/setup.integration.ts` from swapping the global connection, and the Postgres integration suite. Tracked as `add-scope-harness`. This change may update that file's import path so it still resolves.
- The Wasmtime process, pg-proxy, and `spike-wasmtime-reopen`. Tracked as `add-wasmtime-process` and `spike-wasmtime-reopen`.
- Savepoints and nested-transaction flattening. Tracked as AR7 in `docs/PRD.md`.
- Replacing `sql.raw` interpolation of raw `where` values in `query-builder.ts`. Bound `eq()` stays the parameterized path.
