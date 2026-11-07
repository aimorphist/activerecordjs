# Tasks

- [ ] Add a native host under `host/wasmtime/` that links Wasmtime and the WASI Postgres module pinned in `docs/spikes/wasmtime-reopen/finding.md`. The server path does not run Node.
- [ ] One owner thread, one `Store`, one preopened data directory. Callers submit SQL text and parameters. A bound insert commits, a second bound insert rolls back, and a new process opening that directory sees only the committed row.
- [ ] Waiters share a queue of capacity 8. The live token skips that queue. A wait past 5 seconds rolls the open transaction back, and the error names the timeout.
- [ ] The acceptance command exits 0 and does not invoke Node to serve SQL.
- [ ] Amend the `ARCHITECTURE.md` runtime section so the guest question is the decided host shape, not an open spike.
