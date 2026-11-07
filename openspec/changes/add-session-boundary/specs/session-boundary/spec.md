## ADDED Requirements

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
The system SHALL expose a connection scope with `run(fn)`, `transaction(fn)`, and `close()`. `run` SHALL invoke `fn` with the scope's session. `transaction` SHALL begin a transaction, invoke `fn` with a scope that carries the lease token, keep that scope for hook awaits inside `fn`, then commit. If `fn` throws, `transaction` SHALL roll back and release the token. `close` SHALL reject further work on that scope.

#### Scenario: Transaction callback keeps the lease token across an await
- GIVEN an open scope
- WHEN `scope.transaction` runs a callback that awaits before it finishes
- THEN the callback's scope still carries the lease token after the await
- AND the transaction commits only after the callback resolves

#### Scenario: Thrown callback rolls back
- GIVEN an open scope
- WHEN the `transaction` callback throws
- THEN the transaction rolls back
- AND the lease token is released

### Requirement: Missing scope
A Model, query builder, or association call that needs a database SHALL throw when no scope is bound. The throw SHALL happen before a driver method is invoked.

#### Scenario: Find with nothing bound
- GIVEN no scope bound in the current context
- WHEN `User.find` runs
- THEN it throws
- AND no driver `select` runs

### Requirement: Node ambient binding
The node entry SHALL bind the active scope with AsyncLocalStorage. `createActiveRecordJS` SHALL live on that entry and SHALL bind the scope it is given. While a scope is bound, Model methods SHALL read it so `User.find` takes no scope argument. The core entry SHALL NOT import `node:async_hooks`.

#### Scenario: Find uses the bound scope
- GIVEN `createActiveRecordJS` has bound a scope on Node
- WHEN `User.find` runs with no scope argument
- THEN the query uses that bound scope

### Requirement: Scope travels with the query
A query builder, a model instance, and an association lookup SHALL keep the scope they were created with. Later awaits SHALL NOT retarget that work by writing a process-wide connection.

#### Scenario: Builder keeps the scope from its model
- GIVEN a model read that started under scope A
- WHEN the query builder executes after an await
- THEN the statement runs on scope A

### Requirement: Nested transaction
`scope.transaction` called from inside a `scope.transaction` callback SHALL throw. The system SHALL NOT flatten the inner call into the outer transaction and SHALL NOT open a savepoint.

#### Scenario: Inner transaction throws
- GIVEN a callback already running inside `scope.transaction`
- WHEN that callback calls `scope.transaction` again
- THEN the call throws
- AND the outer transaction is still the only open transaction
