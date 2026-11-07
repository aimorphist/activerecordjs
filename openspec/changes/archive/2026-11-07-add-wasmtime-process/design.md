# Design

The spike record is `docs/spikes/wasmtime-reopen/finding.md` (go, 2026-11-07). The host under test was native C against the Wasmtime 38.0.3 C API. The database was the draft `pglite-bindings` module at commit `0d31326a41f7251548103f73e601699b0ebae2fa`, PostgreSQL 16.6, one preopen, and the module's file socket for Postgres wire messages. Parse and Bind carried the parameter. A second process opened the same directory. The conductor re-ran `docs/spikes/wasmtime-reopen/repro-command.sh` and it exited 0.

That evidence was arm64 macOS. The process source stays native code with no Node. This change does not add a Linux cross-compile or a Linux CI image, and it does not claim Linux was tested.

`host/wasmtime/` holds the process. `src/` stays the TypeScript library. The package script that runs the acceptance command does not start Node to serve SQL.

One thread owns the `Store` and calls the module. Other callers enqueue. Capacity 8 is the number of parked waiters, not a hint. The ninth caller is rejected at once with an error that names the full queue. Nobody blocks outside that queue. The 5 second deadline starts when a caller enters the queue and bounds only that wait. It does not preempt a guest call. A waiter who expires is removed, receives an error that names the timeout, and is never dispatched. That expiry does not roll back the holder.

Begin returns a token. A submission that carries the live token runs on the owner after the current guest call returns, and before the next parked waiter. It does not enter the guest beside another call. At most one holder submission may sit behind the in-flight call. Another one is rejected, and the error names the holder backlog. A nested transaction throws. An autocommit submit does not run while a token is live.

The in-process operations are `submit(sql, params)`, `begin()`, `submit(token, sql, params)`, `commit(token)`, and `rollback(token)`. Parameters are a separate list. Each submit is one statement. The host strips leading whitespace and leading line or block comments, then rejects a semicolon that still has non-whitespace after it. One trailing semicolon is still one statement. The first keyword, ignoring case, must not be `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `START`, `END`, or `ABORT`, so `START TRANSACTION`, `END`, and `ABORT` cannot move the lease. Rejection happens before the guest runs, and the token and the transaction stay as they were. This keyword list plus the semicolon rule is the whole policy. It is not a general SQL parser.

A token retires on commit, on rollback, and when cleanup of that transaction fails. A retired token is rejected before any guest call. A successor enters only after the token is retired and the session is idle. If cleanup cannot leave an idle session, the process refuses every later submission and names the failed cleanup. The next open is a new process. Fault injection is enough to show that path. The draft module's stubs stay unfixed.

The data directory must already hold the seeded cluster from the pinned archive. The host does not delete it and does not run initdb over it. An empty directory fails before a `Store` exists, and the error names the missing cluster. After the cluster check the host creates a lock file. A second process that finds the lock exits without a `Store` and names the lock. The first host keeps serving. A lock left by a crash is the operator's to remove. The host does not steal a lock that is present.

The acceptance command is `bash host/wasmtime/accept.sh` from the repository root. It needs arm64 macOS, Apple clang, curl, tar, shasum, and either the network or a cache for the pinned Wasmtime C SDK and the pinned WASI archive. It does not invoke Node. It covers the bound parameter, the reopen, the ninth caller, holder bypass on a full queue, an expired waiter that leaves the holder's transaction open, a retired token, nested transaction, autocommit exclusion, the empty directory, the second process, a fault-injected cleanup failure, and rejection before dispatch of `END`, a comment-prefixed `START TRANSACTION`, and two statements in one submit. Linux is the same source and is not a result this command claims. Power loss is not a result this command claims.

The module's own stubs stay as the finding recorded them: incomplete overflow and exception handling, stubbed IPC and timers, forced lock-file handling. This change does not patch PostgreSQL. `fsync` and `synchronous_commit` stay at the module defaults the spike observed (`on`).

The pinned module is the one in the finding. A different WASI artifact, or a bump that changes the guest exports the host calls, is a new spike. It is not a silent swap.

`ARCHITECTURE.md` currently says the guest question is still decided by the spike, above the section that records the go. This change replaces that open sentence with the decided shape: native host, one owner, SQL and parameters across, ORM outside the guest.
