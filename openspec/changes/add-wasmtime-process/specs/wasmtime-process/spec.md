## ADDED Requirements

### Requirement: Native Wasmtime host
The server process SHALL be a native Wasmtime host. It SHALL load one WASI Postgres module, own one `Store` on one thread, and preopen one data directory. The server path SHALL NOT run Node.

#### Scenario: A bound query does not use Node
- GIVEN the acceptance command for the host
- WHEN it serves one bound-parameter statement
- THEN the serving process is the native host
- AND that command does not invoke Node to serve SQL

### Requirement: Rollback and reopen
A committed row SHALL be present after a new process opens the same data directory. A row inserted in a transaction that rolled back SHALL be absent.

#### Scenario: The second process sees only the commit
- GIVEN a host process that committed one bound insert and rolled back a second bound insert
- WHEN a new process opens the same data directory and reads the table
- THEN the committed value is present
- AND the rolled-back value is absent

### Requirement: One owner queue
Callers other than the owner SHALL wait on one queue of capacity 8. Work that carries the live lease token SHALL run without waiting behind the next waiter. A wait longer than 5 seconds SHALL roll the open transaction back and SHALL raise an error that names the timeout. A nested transaction SHALL throw.

#### Scenario: The holder is not stuck behind the next waiter
- GIVEN a transaction holding the live token
- AND another caller waiting on the queue
- WHEN the holder submits another statement
- THEN that statement runs
- AND it does not wait for the queued caller

#### Scenario: The timeout names itself
- GIVEN a caller that has waited 5 seconds for the owner
- WHEN the wait expires
- THEN the open transaction is rolled back
- AND the error names the timeout
