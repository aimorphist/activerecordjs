# session-boundary

## Requirements

### Requirement: Core entry
The core package entry SHALL export Model, the query builder, associations, and the scope types. Its import graph SHALL NOT include a `node:` builtin, the `postgres` package, or `@electric-sql/pglite`. The `postgres-js` entry and the `node` entry SHALL be importable without loading each other.

#### Scenario: Core module loads without Node or a driver
- GIVEN the core entry module
- WHEN its import graph is inspected
- THEN it does not import `node:`, `postgres`, or `@electric-sql/pglite`
- AND the `postgres-js` entry and the `node` entry are separate modules

### Requirement: Shared session type
The system SHALL type the session passed to models and query builders as Drizzle's `PgDatabase`. `Model.query` SHALL take that surface. Driver client types SHALL stay inside the adapter that creates them.

#### Scenario: Query callback receives the shared session
- GIVEN a scope bound to a Postgres session
- WHEN `Model.query` runs its callback
- THEN the callback receives a `PgDatabase`
- AND the callback's parameter type is not `PostgresJsDatabase`

### Requirement: Explicit scope
The system SHALL expose a connection scope with `run(fn)`, `transaction(fn)`, `close()`, and `model(table)`. `run` SHALL invoke `fn` with that scope. `model(table)` SHALL return a model class bound to that scope. A caller that has loaded only the core entry SHALL be able to find a row through that class. `transaction` SHALL begin a transaction, invoke `fn` with a callback scope that carries the lease token and uses the driver's transaction session, keep that scope for hook awaits inside `fn`, then commit and retire the token. If `fn` throws, or if commit or rollback itself throws, `transaction` SHALL roll back when the transaction is still open, retire the token, and propagate the error. `close` SHALL reject further work on the scope it is called on.

#### Scenario: Transaction callback keeps the lease token across an await
- GIVEN an open scope
- WHEN `scope.transaction` runs a callback that awaits before it finishes
- THEN the callback's scope still carries the lease token after the await
- AND the transaction commits only after the callback resolves

#### Scenario: Thrown callback rolls back
- GIVEN an open scope
- WHEN the `transaction` callback throws
- THEN the transaction rolls back
- AND the lease token is retired

#### Scenario: Core caller binds a model without the node entry
- GIVEN a scope and the node entry is not loaded
- WHEN the caller takes `scope.model(table)` and calls `find`
- THEN the query uses that scope
- AND no `node:` module is loaded

### Requirement: Captured scope wins
A model class from `scope.model`, a query builder, a hydrated instance, and an association lookup created under scope A SHALL keep scope A. A later ambient scope SHALL NOT retarget that work. Hooks and related-model lookups SHALL use the scope captured on the owner. Inside `transaction`, that scope is the callback scope, so an awaited hook and a belongs-to load use the driver's transaction session. An unbound static call SHALL use the node ambient scope when one is bound, and SHALL throw when none is bound. The captured scope SHALL win over the ambient scope.

#### Scenario: Delayed builder stays on A
- GIVEN a query builder created under scope A
- WHEN an ambient scope B is bound and the builder executes after an await
- THEN the statement runs on scope A

#### Scenario: Related lookup uses the transaction session
- GIVEN an instance loaded under a transaction callback scope
- WHEN an awaited hook or a belongs-to load runs
- THEN that lookup uses the callback scope's transaction session
- AND it does not use the root session

#### Scenario: Concurrent Node contexts stay apart
- GIVEN two Node async contexts, one with scope A bound and one with scope B bound
- WHEN each context calls `find` on an unbound model
- THEN each call uses the scope bound in its own context

### Requirement: Missing scope
A Model, query builder, or association call that needs a database SHALL throw when no scope is bound. The throw SHALL happen before a driver method is invoked.

#### Scenario: Find with nothing bound
- GIVEN no scope bound in the current context
- WHEN `User.find` runs
- THEN it throws
- AND no driver `select` runs

### Requirement: Node ambient binding
The node entry SHALL bind the active scope with AsyncLocalStorage. `createActiveRecordJS(db)` SHALL live on that entry, SHALL store a default scope in the node entry, and SHALL return the model factory. `setGlobalConnection(db)` SHALL live on that entry and SHALL replace that node default. It SHALL NOT write a database into the core entry. `runWithConnection(db, fn)` SHALL bind `db` for `fn` and SHALL restore the previous store when `fn` finishes. While a scope is bound, an unbound `User.find` SHALL take no scope argument. The core entry SHALL NOT import `node:async_hooks` and SHALL hold no default session.

#### Scenario: Find uses the bound scope
- GIVEN `createActiveRecordJS` has bound a scope on Node
- WHEN `User.find` runs with no scope argument
- THEN the query uses that bound scope

#### Scenario: Context binding restores the node default
- GIVEN a node default scope A
- WHEN `runWithConnection` runs a callback under scope B and then returns
- THEN a later unbound `User.find` in the outer context uses scope A
- AND the core entry still holds no session

### Requirement: Scope travels with the query
A query builder, a model instance, and an association lookup SHALL keep the scope they were created with. Later awaits SHALL NOT retarget that work by writing a process-wide connection.

#### Scenario: Builder keeps the scope from its model
- GIVEN a model read that started under scope A
- WHEN the query builder executes after an await
- THEN the statement runs on scope A

### Requirement: Nested transaction
Calling `transaction` on the callback scope SHALL throw. Calling `transaction` on the same root scope that already has that transaction open SHALL throw. A different root scope SHALL be able to open its own transaction at the same time. The system SHALL NOT flatten a rejected call into the outer transaction and SHALL NOT open a savepoint.

#### Scenario: Callback scope rejects re-entry
- GIVEN a callback scope for an open transaction
- WHEN `transaction` is called on that callback scope
- THEN the call throws
- AND the outer transaction is still the only transaction on that root

#### Scenario: Retained root rejects re-entry
- GIVEN a root scope with a transaction callback in progress
- WHEN `transaction` is called on that same root scope
- THEN the call throws

#### Scenario: Another root proceeds
- GIVEN one root scope inside `transaction`
- WHEN a different root scope calls `transaction`
- THEN the second call begins its own transaction

### Requirement: Transaction scope lifetime
The callback scope SHALL issue statements on the driver's transaction session. The lease token SHALL retire on commit, on rollback, and when completion throws. A retired callback scope, and a builder created from it, SHALL throw before any driver method. `close` on the callback scope SHALL reject further work on that callback scope and SHALL NOT close the root client. `close` on the root during a callback SHALL roll back the open transaction, retire the token, and then close the client that root owns.

#### Scenario: Child statement uses the transaction session
- GIVEN a session that distinguishes the root session from the transaction session
- WHEN the callback runs a statement
- THEN the statement is issued on the transaction session

#### Scenario: Escaped child cannot run after commit
- GIVEN a builder created inside the callback
- WHEN the callback has committed and the builder executes
- THEN it throws
- AND no driver method runs

#### Scenario: Child close leaves the root client open
- GIVEN an open root and its callback scope
- WHEN `close` is called on the callback scope
- THEN further callback work throws
- AND the root client stays open

#### Scenario: Root close stops the active callback
- GIVEN a transaction callback in progress
- WHEN `close` is called on the root scope
- THEN the open transaction rolls back
- AND the token is retired
- AND the root client closes
