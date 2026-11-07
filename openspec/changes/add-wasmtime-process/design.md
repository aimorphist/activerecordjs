# Design

The spike record is `docs/spikes/wasmtime-reopen/finding.md` (go, 2026-11-07). The host under test was native C against the Wasmtime 38.0.3 C API. The database was the draft `pglite-bindings` module at commit `0d31326a41f7251548103f73e601699b0ebae2fa`, PostgreSQL 16.6, one preopen, and the module's file socket for Postgres wire messages. Parse and Bind carried the parameter. A second process opened the same directory. The conductor re-ran `docs/spikes/wasmtime-reopen/repro-command.sh` and it exited 0.

That evidence was arm64 macOS. The process source stays native code with no Node. This change's acceptance command is that native build-and-run on the machine whose Wasmtime C SDK matches the host arch. A Linux binary is the same source. This change does not add a Linux cross-compile or a Linux CI image.

`host/wasmtime/` holds the process. `src/` stays the TypeScript library. The package script that runs the acceptance command does not start Node to serve SQL.

One thread owns the `Store` and calls the module. Other callers enqueue. The queue capacity defaults to 8, because this is a handful of waiters on one database, not a connection pool. The wait defaults to 5 seconds, the same bound as the PGlite lease. On timeout the owner rolls the open transaction back, drops the holder, and the error names the timeout. The next waiter may enter.

Begin returns a token. A later submission that carries the live token runs on the owner without taking a queue slot behind the next waiter. A nested transaction still throws. It does not become a savepoint and it does not become another wait.

The module's own stubs stay as the finding recorded them: incomplete overflow and exception handling, stubbed IPC and timers, forced lock-file handling. This change does not patch PostgreSQL. `fsync` and `synchronous_commit` stay at the module defaults the spike observed (`on`).

The pinned module is the one in the finding. A different WASI artifact, or a bump that changes the guest exports the host calls, is a new spike. It is not a silent swap.

`ARCHITECTURE.md` currently says the guest question is still decided by the spike, above the section that records the go. This change replaces that open sentence with the decided shape: native host, one owner, SQL and parameters across, ORM outside the guest.
