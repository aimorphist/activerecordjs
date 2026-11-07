---
spike_id: wasmtime-reopen
hypothesis_id: wasmtime-reopen
source_synthesis: null
run_at: 2026-11-07T16:48:29Z
time_spent_min: 5
verdict: go
version-pinned: "PostgreSQL 16.6 / pglite-bindings@0d31326a41f7251548103f73e601699b0ebae2fa / Wasmtime 38.0.3"
---

# Spike: WASI Postgres bound parameters, rollback, and process reopen

## Claim Tested

One WASI Postgres under Wasmtime can execute one bound-parameter statement, roll a second statement back, exit, and after a new process opens the same directory show the committed row and not the rolled-back row.

## Minimal Test

Compile one C executable against the native Wasmtime C API, load one WASI Postgres instance on its main thread, and preopen one private runtime/data root as `/`. Use one database, `template1`, from the upstream seed cluster; create a fresh test table. Send the fixed SQL `INSERT INTO wasmtime_reopen(value) VALUES ($1::text) RETURNING value` in a PostgreSQL Parse message and send the value separately in a Bind message, then Execute and Sync; explicitly commit the first transaction and roll back a second transaction containing another bound insert. Exit the host without an explicit checkpoint or Postgres shutdown, launch a separate executable process against exactly the same root, and assert that a full-table select returns exactly the committed value. Capture version, configuration, process IDs, preopen count, protocol acknowledgments, returned values, and assertions in the raw log.

The minimal test was printed before execution. Both values contain SQL punctuation; the committed value also contains Unicode. No value is substituted into SQL text.

## Artifact Choice

Selected the **draft pglite-bindings / libpglite tree**, using its checked-in `16.x/pglite-wasi.tar.gz`, not a new Postgres build and not the workspace's Emscripten `@electric-sql/pglite` client. The guest reports PostgreSQL **16.6**. The archive contains a preinitialized cluster; this spike proves reopen of that cluster, not creation of a cluster from empty storage.

Pinned inputs:

| Input | Pin / SHA-256 |
| --- | --- |
| [pglite-bindings artifact](https://github.com/electric-sql/pglite-bindings/blob/0d31326a41f7251548103f73e601699b0ebae2fa/16.x/pglite-wasi.tar.gz) | commit `0d31326a41f7251548103f73e601699b0ebae2fa` |
| Artifact archive | `08c0cdd779770316e373f4ad16a20696eb5a0b28cfe981a0dbd0933ef866f3f7` |
| `postgres.wasi` inside archive | `06494174ce71c387898fdc8d246062448a4aeeda3d290a7c347a5d87ba39e53c` |
| [Wasmtime C SDK, arm64 macOS](https://github.com/bytecodealliance/wasmtime/releases/tag/v38.0.3) | `38.0.3` |
| SDK archive | `0a189dd112991d1d037960fafdad86c659c76f013a963cf63e52228340651a52` |

The host uses `_start`, `pg_initdb`, `use_socketfile`, `use_wire(1)`, and `interactive_one`. All protocol traffic uses the draft's `.s.PGSQL.5432.in/.out` file transport inside the single preopen. The same preopen also contains the runtime resources and a seeded `/dev/urandom` file; there is no second directory capability. The host needs no socket listener, Node, JavaScript client, Python embedding, ORM, or guest application.

## Evidence

- [evidence.code](evidence.code): complete native C host and protocol encoder/parser; built with assertions enabled and `-Wall -Wextra -Werror`.
- [evidence.log](evidence.log): raw successful run, including both process IDs, runtime diagnostics, ParseComplete (`1`), BindComplete (`2`), both inserted values, `COMMIT`, `ROLLBACK`, and the reopen assertion. `fsync` and `synchronous_commit` both report `on`.
- [repro-command.sh](repro-command.sh): exact reproduction, pinned downloads with checksum verification, fresh extraction, native compilation, and sequential writer/reader executions. Run `bash docs/spikes/wasmtime-reopen/repro-command.sh` from the repository root on arm64 macOS with Apple clang, curl, tar, and shasum available. It overwrites `evidence.log`, uses temporary files only under this spike directory, and removes those files on exit.

The decisive log ending is:

```text
RESPONSE D payload=37 row=committed ' ; -- unicode: café
RESPONSE C payload=9 command=SELECT 1
RESPONSE Z payload=1 transaction=I
ASSERT reopen: committed row present, rolled-back row absent
PASS phase
PASS: placeholder + Bind, rollback, separate-process reopen
```

## Verdict: go

The native executable ran both real placeholder inserts, received protocol acknowledgments and exact returned values, committed the first transaction, rolled back the second, and reopened the same on-disk cluster in a new process. The second process returned exactly one row with the committed value. This supports the **native host owns WASI Postgres and exposes SQL text plus parameters** shape; putting the ORM in a guest is not required for the tested sequence. A future application guest could use a host SQL import backed by this facility. Actual component/WIT import plumbing was not part of this test.

The result is limited to this pinned draft, single-owner sequence and host platform. Upstream diagnostics include stubbed IPC/timer operations, forced lock-file handling, and executable-location warnings; these did not prevent the assertions from passing. Process exit followed by recovery was tested, but power loss, concurrent owners, a production queue, overflow/error recovery, and production readiness were not. The archive contains other seed databases, while both phases operate only on `template1`. No synthesis metadata exists to update; the conductor owns tracking and follow-up.
