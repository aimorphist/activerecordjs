## ADDED Requirements

### Requirement: PGlite entry
The system SHALL expose a `pglite` package entry that opens one database with the official `@electric-sql/pglite` client and `drizzle-orm/pglite`. The core package entry SHALL NOT import `@electric-sql/pglite`. Omitting a data directory SHALL open a memory database. Passing a directory SHALL persist in that directory.

#### Scenario: Memory database
- GIVEN no data directory
- WHEN a caller opens a PGlite scope
- THEN the scope talks to one in-memory PGlite database
- AND the core entry still does not import `@electric-sql/pglite`

#### Scenario: Directory database
- GIVEN a data directory
- WHEN a caller opens a PGlite scope on that directory
- THEN rows committed through that scope are stored in that directory

### Requirement: Exclusive lease
The PGlite scope SHALL grant one exclusive lease on its single session. `transaction` SHALL hold that lease from begin until commit or rollback, including awaits inside the callback and inside hooks. A second `transaction` SHALL wait until the lease is free. Autocommit work SHALL wait while the lease is held. Work that carries the live lease token SHALL run without waiting behind the next waiter. The system SHALL NOT start a second statement on that session while the lease is held by someone else.

#### Scenario: Second transaction waits
- GIVEN a PGlite transaction in progress
- WHEN another caller starts a transaction
- THEN the second transaction begins only after the first commits or rolls back

#### Scenario: Holder does not wait behind the next caller
- GIVEN a transaction callback that awaits, and another transaction already queued
- WHEN the callback issues another statement
- THEN that statement runs before the queued transaction begins

#### Scenario: Autocommit waits
- GIVEN a PGlite transaction in progress
- WHEN another caller runs a statement outside a transaction
- THEN that statement runs only after the transaction commits or rolls back

### Requirement: Lease timeout
The lease wait SHALL default to 5 seconds. When the wait exceeds that limit, the system SHALL roll back the open transaction if one is open, release the lease, and raise an error whose message names the timeout.

#### Scenario: Timed-out wait rolls back
- GIVEN a transaction that is still open when another caller has waited 5 seconds
- WHEN the wait expires
- THEN the open transaction rolls back
- AND the lease is released
- AND the waiting caller receives an error that names the timeout

### Requirement: Nested transaction stays a throw
A `transaction` call on the callback scope, or on the same root while that callback is the holder, SHALL throw. The system SHALL NOT flatten that call and SHALL NOT open a savepoint. A waiter queued from outside the holder SHALL NOT be treated as a nested transaction.

#### Scenario: Re-entry throws
- GIVEN a PGlite transaction callback
- WHEN that callback calls `transaction` again
- THEN the call throws
- AND the outer transaction is still the only open transaction

### Requirement: Session state
On the PGlite adapter, the system SHALL reject `SET`, temporary tables, and advisory locks. `SET LOCAL` issued while the lease is held SHALL be allowed.

#### Scenario: SET is rejected
- GIVEN an open PGlite scope
- WHEN a caller executes `SET`
- THEN the call throws
- AND the statement is not applied

#### Scenario: SET LOCAL inside the lease
- GIVEN a PGlite transaction callback
- WHEN the callback executes `SET LOCAL`
- THEN the statement runs on that transaction

### Requirement: PGlite behavior tests
A PGlite test run SHALL create, find, update, and destroy one row, roll a transaction back, and load one association. A second case SHALL close the scope, open the same directory again, and show the committed row present and the rolled-back row absent.

#### Scenario: Memory CRUD and rollback
- GIVEN a memory PGlite scope and a model bound with `scope.model`
- WHEN the test creates, finds, updates, destroys, rolls back, and loads one association
- THEN each of those operations behaves as the model API specifies

#### Scenario: Directory reopen
- GIVEN a directory that has one committed row and one rolled-back row
- WHEN a new PGlite scope opens that directory
- THEN the committed row is present
- AND the rolled-back row is absent
