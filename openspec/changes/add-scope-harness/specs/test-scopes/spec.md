## ADDED Requirements

### Requirement: Per-test scope
The Postgres integration harness SHALL bind a `ConnectionScope` for each test on a connection reserved for that test. Model calls, query builders, and association lookups in the test SHALL use that scope. When the test ends, the harness SHALL roll the transaction back and release the connection. `src/setup.integration.ts` SHALL NOT call `setGlobalConnection`.

#### Scenario: A test writes through its scope
- GIVEN a Postgres integration test
- WHEN the test creates a row
- THEN the create uses the scope bound for that test
- AND `setup.integration.ts` does not call `setGlobalConnection`

#### Scenario: The next test does not see the row
- GIVEN a test that inserted a row
- WHEN the following test in the same file looks for that row
- THEN the row is absent

### Requirement: Parallel Postgres files
Two Postgres integration files running at the same time SHALL each hold their own connections. One file's transaction SHALL NOT block the other file's statements.

#### Scenario: Two files proceed together
- GIVEN two integration files running in parallel
- WHEN each file opens its test transaction
- THEN both transactions are open at the same time

### Requirement: Integration suite
`bun run test:integration` SHALL pass against the Postgres database named by `TEST_DATABASE_URL`, or `postgresql://activerecordjs:activerecordjs@localhost:5433/activerecordjs_test` when that variable is unset.

#### Scenario: Suite passes
- GIVEN that Postgres is accepting connections
- WHEN `bun run test:integration` runs
- THEN the command exits 0
