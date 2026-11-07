# Learnings

2026-11-07: A Vitest store set around a fixture `use()` does not reach the test body. The Postgres harness opens one connection in the `scope` fixture and installs that callback scope with `aroundEach` and `runWithConnection`.
