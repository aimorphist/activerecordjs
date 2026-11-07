# Design

The landed `ConnectionScope` throws when `transaction` is called on a root that already has one open. That is the right rule for a postgres.js pool, where a second root is a second connection. PGlite has one session, so the adapter does not open a second root and it does not let the second caller hit that throw.

`openPglite` builds one `drizzle-orm/pglite` session and one root `ConnectionScope`. The exported scope is a lease gate in front of that root.

- `transaction` from a caller who does not hold the lease joins a bounded queue, then calls the root's `transaction` once the previous holder has finished.
- The callback receives the root's callback scope, whose `LeaseToken` is live. Further statements on that scope, including hook awaits, run immediately. They do not pass the queue.
- `run` and any other autocommit path take the same lease for the length of the call, or wait if it is held.
- A second `transaction` from inside the callback is a nested call on the root. The root throws. The queue does not turn that into a wait.
- Default wait is 5 seconds, overridable on `openPglite`. On timeout the gate aborts the open transaction through the root (rollback, token retired), releases the lease, and throws an error that names the timeout. The next waiter may then enter.

If the official client already runs one statement at a time, this gate is still the transaction owner. It does not add a second statement queue. The implementation checks that once and records it next to the gate.

`SET`, `CREATE TEMP`, and advisory-lock calls are rejected by the gate before they reach the session. `SET LOCAL` is passed through while the token is live.

Tests live in a `test:pglite` script so they do not need the Postgres docker compose. Memory covers the model operations. One directory covers reopen. `src/setup.integration.ts` stays on the node global swap.
