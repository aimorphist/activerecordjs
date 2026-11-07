# host/wasmtime

The native Wasmtime process for one WASI Postgres. The contract is `openspec/changes/add-wasmtime-process/`, and the evidence it builds on is `docs/spikes/wasmtime-reopen/finding.md`.

- `pghost.h`, `pghost.c`: the host library. `pghost_open` checks that the seeded cluster is present, takes `wasmtime-host.lock`, and starts the owner thread, which owns the only `Store`. The in-process operations are `pghost_submit`, `pghost_begin`, `pghost_submit_tx`, `pghost_commit`, and `pghost_rollback`. Parameters go to the guest in a Postgres Bind message, never in the SQL text.
- `accept_test.c`: the acceptance driver. Each phase runs as its own native host process.
- `accept.sh`: the acceptance command. Run `bash host/wasmtime/accept.sh` from the repository root. It downloads the pinned Wasmtime 38.0.3 C SDK and the `pglite-bindings@0d31326a` archive into `.work/cache`, checks both checksums, builds with `clang -Wall -Wextra -Werror`, and runs every scenario against a fresh copy of the seeded cluster. If anything on `PATH` invokes `node`, a shim fails the run.

Limits: this was tested on arm64 macOS only. The same source is expected to build on Linux, but that has not been tested. Power loss has not been tested. The draft module's stubs are unchanged, and there is no watchdog. A guest call that stalls holds the owner until it returns. The queue deadline bounds only time spent waiting in the queue. Removing a lock left by a crash is the operator's job.
