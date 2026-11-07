# Tasks

- [ ] Add a native host under `host/wasmtime/` that links Wasmtime and the WASI Postgres module pinned in `docs/spikes/wasmtime-reopen/finding.md`. The server path does not run Node.
- [ ] One owner thread, one `Store`, one preopened data directory. Callers submit SQL text and parameters. A bound insert commits, a second bound insert rolls back, and a new process opening that directory sees only the committed row.
- [ ] Waiters share a queue of capacity 8. The live token skips that queue. A wait past 5 seconds rolls the open transaction back, and the error names the timeout.
- [ ] `bash host/wasmtime/accept.sh` exits 0 from the repository root on arm64 macOS. Prerequisites are Apple clang, curl, tar, shasum, and the pinned Wasmtime C SDK plus the pinned WASI archive. The command does not invoke Node. It covers the bound parameter (including a punctuation and café value kept out of the SQL text), reopen, the ninth caller, holder bypass on a full queue, an expired waiter, a retired token, nested transaction, autocommit exclusion, the empty directory, the second process, and a fault-injected cleanup failure.
- [ ] Amend the `ARCHITECTURE.md` runtime section so the guest question is the decided host shape, not an open spike.

## Owed from advise — 2026-11-07

- [x] R1: Specify bounded caller admission, full-queue behavior, deadline start, and serialized holder bypass; pin native SQL/parameter/result/error operations and transaction-control SQL handling. Add saturation, holder-bypass, and separate-parameter acceptance scenarios. See `reviews/2026-11-07-advise.md`.
- [x] R2: Specify timeout/rollback completion, canceled-waiter removal, token retirement and stale-token rejection, busy-guest behavior, and fail-closed handling when cleanup cannot establish a clean session. Add timeout, late-holder, canceled-request, and injected cleanup-failure acceptance scenarios.
- [x] R3: Specify seeded-directory startup without overwriting existing data and exclusive directory ownership, either enforced or an explicit prerequisite with limitations. Add acceptance for the chosen startup policy and second-owner rejection if enforced.
- [x] R4: Name the native acceptance command and prerequisites; cover R1–R3, ordinary transaction/autocommit exclusion, nested-transaction rejection, and the existing bound-query/reopen sequence in tasks and the new capability delta. Keep Linux and durability claims aligned with demonstrated evidence.
- [ ] Fresh advise after preparation
