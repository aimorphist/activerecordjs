# add-wasmtime-process

> **ACTIVE BUILD**

**Rigor:** architecture

## Why

The reopen spike went go. A native Wasmtime host can run the draft WASI Postgres, send a bound parameter, roll a second statement back, and show only the committed row after a new process opens the same directory. The server milestone is that host, with one owner and a bounded queue of callers. The ORM stays on the host side of that boundary.

## What

- Add the `wasmtime-process` capability: a native process that owns one Wasmtime `Store`, one WASI Postgres, and one preopened data directory.
- Callers use in-process operations: SQL text plus a separate parameter list. Eight waiters may park. The ninth is rejected. A waiter who waits 5 seconds is canceled and does not run. The holder of the live token runs before those waiters and does not enter the guest beside another call. A failed cleanup closes the process to later submissions.
- Keep Node off the server path. Do not put the ORM in the guest.

## Impact

- Capabilities: ADDED `wasmtime-process`
- ADRs: will amend `ARCHITECTURE.md`. The runtime section still says the guest question is open. The spike closed it for this sequence.

## User journey & surfaces

No new UI because this is a native database process, not a product screen. The outcome reaches a caller that starts the host and submits SQL, and the host's acceptance command.

## Out of scope

- A TypeScript client for the process. Callers in this change speak the host's queue.
- ComponentizeJS, and placing Model inside the guest. The finding shows a host SQL boundary is enough for the tested sequence.
- The official `@electric-sql/pglite` client, and a Node process whose job is to embed Wasmtime under that client.
- Changing the JS PGlite lease in `src/pglite.ts`.
- Savepoints. Tracked as AR7 in `docs/PRD.md`.
- Electric sync, pgvector, and hardening the draft module's stubbed overflow and exception paths.
