# Tasks

- [ ] Add `@electric-sql/pglite` and a `./pglite` package entry. The core entry still does not import it.
- [ ] `openPglite` returns one `ConnectionScope` over `drizzle-orm/pglite`. No directory means a memory database. A directory persists there.
- [ ] One exclusive lease. A second `transaction` waits. Autocommit waits while the lease is held. A call that carries the live `LeaseToken` runs without waiting behind the next waiter.
- [ ] The wait defaults to 5 seconds. On timeout the open transaction rolls back, the lease is released, and the error names the timeout.
- [ ] Nested `transaction` still throws. The waiter is not a nested call and it is not a savepoint.
- [ ] On this adapter, `SET`, temporary tables, and advisory locks throw. `SET LOCAL` inside a held lease is allowed.
- [ ] Confirm whether the PGlite client already serializes statements. The lease stays the transaction owner either way. Record the confirmation next to the lease.
- [ ] `bun run test:pglite` covers create, find, update, destroy, a transaction rollback, and one association load, on a memory database.
- [ ] The same run reopens one directory: a committed row is present and a rolled-back row is absent.
- [ ] `bun run test:unit` still passes.
