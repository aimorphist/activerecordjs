## ADDED Requirements

### Requirement: Native Wasmtime host
The server process SHALL be a native Wasmtime host. It SHALL load one WASI Postgres module, own one `Store` on one thread, and preopen one data directory. The server path SHALL NOT run Node. Callers SHALL use in-process operations, not a network listener: `submit(sql, params)`, `begin()`, `submit(token, sql, params)`, `commit(token)`, and `rollback(token)`. `params` SHALL travel separately from the SQL text. The SQL text the guest receives SHALL NOT contain the parameter values. `submit` SHALL return rows or an error. Each `submit` SHALL carry one statement. After leading whitespace and leading `--` or `/* */` comments are removed, a semicolon with any non-whitespace after it SHALL be rejected as more than one statement. A single trailing semicolon SHALL be one statement. The first keyword, compared case-insensitively, SHALL NOT be `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `START`, `END`, or `ABORT`. The host SHALL reject these before any guest call. A rejection SHALL leave the token and the transaction as they were.

#### Scenario: A bound query does not use Node
- GIVEN the acceptance command `bash host/wasmtime/accept.sh`
- WHEN it serves one bound-parameter statement
- THEN the serving process is the native host
- AND that command does not invoke Node to serve SQL

#### Scenario: Transaction control in the SQL text does not run
- GIVEN a live token
- WHEN the caller submits `END`, or submits ` -- note` followed by `START TRANSACTION`, or submits two statements separated by a semicolon
- THEN the host rejects the submission before the guest runs
- AND the token is still live
- AND the transaction is unchanged

#### Scenario: A punctuation value stays out of the SQL text
- GIVEN a parameter value that contains a quote, a semicolon, a comment marker, and the word café
- WHEN the caller submits `INSERT INTO wasmtime_reopen(value) VALUES ($1) RETURNING value` with that parameter
- THEN the guest's statement text does not contain that value
- AND the returned row contains that value

### Requirement: Rollback and reopen
A committed row SHALL be present after a new process opens the same data directory. A row inserted in a transaction that rolled back SHALL be absent. This requirement is process exit and reopen. It is not a power-loss claim, and it is not a claim that Linux was tested.

#### Scenario: The second process sees only the commit
- GIVEN a host process that committed one bound insert and rolled back a second bound insert
- WHEN a new process opens the same data directory and reads the table
- THEN the committed value is present
- AND the rolled-back value is absent

### Requirement: Seeded directory and one owner
The host SHALL open only a directory that already contains the seeded cluster from the pinned WASI archive. It SHALL NOT delete that directory and SHALL NOT run initdb over it. An empty directory SHALL fail before a `Store` is created, and the error SHALL name the missing cluster. The host SHALL create a lock file in that directory after the cluster check. A second process that finds the lock SHALL exit without opening a `Store`, and the error SHALL name the lock. The first process SHALL keep serving. Removing a lock left by a crash is the operator's step. The host SHALL NOT steal a lock that is present.

#### Scenario: An empty directory is refused
- GIVEN a directory with no seeded cluster
- WHEN a host starts on it
- THEN the start fails
- AND the error names the missing cluster
- AND the directory is unchanged

#### Scenario: A second process does not take the directory
- GIVEN a host that holds the directory lock
- WHEN a second process starts on the same directory
- THEN the second process exits
- AND the error names the lock
- AND the first host is still serving

### Requirement: One owner queue
At most 8 callers SHALL be parked on the queue. A ninth caller SHALL be rejected at once, and the error SHALL name the full queue. The caller SHALL NOT block outside the queue. The 5 second deadline SHALL start when the caller enters the queue and SHALL bound that wait only. It SHALL NOT preempt a guest call already in progress. A waiter whose deadline expires SHALL be removed from the queue, SHALL receive an error that names the timeout, and SHALL NOT be dispatched. That expiry SHALL NOT roll back the holder's transaction.

Work that carries the live token SHALL run on the owner thread only after the current guest call returns, and before the next parked waiter. It SHALL NOT enter the guest concurrently with another call. At most one holder submission SHALL be waiting behind the in-flight guest call. A further holder submission SHALL be rejected, and the error SHALL name the holder backlog.

A nested transaction SHALL throw. An autocommit `submit` SHALL NOT run while a token is live.

#### Scenario: The ninth caller is rejected
- GIVEN 8 callers parked on the queue
- WHEN a ninth caller submits
- THEN the ninth caller is rejected
- AND the error names the full queue
- AND the ninth caller is not parked

#### Scenario: The holder is not stuck behind a full queue
- GIVEN a live token
- AND 8 callers parked on the queue
- WHEN the holder submits one statement
- THEN that statement runs before those waiters
- AND it does not enter the guest beside another call

#### Scenario: An expired waiter never runs
- GIVEN a waiter whose 5 second deadline expires before dispatch
- WHEN the owner later becomes free
- THEN that waiter has been removed
- AND the waiter received an error that names the timeout
- AND the waiter's statement did not run
- AND the holder's open transaction is still open

### Requirement: Token retirement
The host SHALL retire a token on commit, on rollback, and when cleanup of that transaction fails. A retired token SHALL be rejected before any guest call, and the error SHALL name the retired token. A successor SHALL enter only after the previous token is retired and the session is idle. If rollback or guest cleanup cannot leave an idle session, the host SHALL refuse every later submission in this process, and the error SHALL name the failed cleanup. Recovery SHALL be a new process. The host SHALL NOT admit another caller into the failed session.

#### Scenario: A late token does not run
- GIVEN a token that was retired by commit
- WHEN the caller submits with that token
- THEN the submission is rejected before the guest runs
- AND the error names the retired token

#### Scenario: A failed cleanup stays closed
- GIVEN a rollback whose guest cleanup fails
- WHEN another caller submits
- THEN the host rejects the submission
- AND the error names the failed cleanup
- AND no new guest call starts in that process
