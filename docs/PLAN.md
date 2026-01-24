# Bagpipe Implementation Plan

> Executable roadmap from design to working system.

**Prerequisites**: [DESIGN.md](./DESIGN.md) and [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Milestones Overview

```
M1: Foundation        M2: Pipes Core       M3: Bags Integration
────────────────      ────────────────     ────────────────────
Project setup         Pipe CRUD            Bags SDK wrapper
Config system         Static decider       Claim aggregation
Storage layer         Execution engine     Claim → Pipe flow
Solana service        Manual trigger
                             │
                             ▼
M4: Lambda Deciders   M5: Scheduling       M6: Recursion
────────────────────  ────────────────     ────────────────
Lambda runtime        Threshold trigger    Pipe → Pipe routing
DeciderContext        Cron trigger         Depth limiting
Effect injection      Retry/backoff        Cycle detection
Example functions     Escape hatch
```

---

## Milestone 1: Foundation

> Project scaffolding, config, storage, Solana basics.

### Deliverables

- [x] Working TypeScript project with deps
- [x] Config loading & validation
- [x] Postgres storage with schema (upgraded from SQLite)
- [x] Solana service (balance queries, transfers)
- [x] Wallet service stub (env var keys)

### Tasks

| Task                         | Effort | Description                              |
| ---------------------------- | ------ | ---------------------------------------- |
| **M1.1** Project init        | S      | `pnpm init`, tsconfig, eslint, structure |
| **M1.2** Dependencies        | S      | Install core deps per ARCHITECTURE.md    |
| **M1.3** Config schema       | S      | Zod schema, .env.example, loader         |
| **M1.4** Logger setup        | S      | Pino wrapper with structured events      |
| **M1.5** Result type         | S      | `Result<T,E>` utility                    |
| **M1.6** Error types         | S      | Base error class, initial error taxonomy |
| **M1.7** Blake3 utils        | S      | hash(), hashHex() functions              |
| **M1.8** Drizzle schema      | M      | pipes, executions tables (SQLite)        |
| **M1.9** Storage interface   | M      | Abstract port + SQLite adapter           |
| **M1.10** Solana service     | M      | Connection, getBalance, getSplBalances   |
| **M1.11** Transfer functions | M      | transferSol, transferSpl                 |
| **M1.12** Wallet service     | S      | EnvWalletService (read from env)         |
| **M1.13** Unit tests         | M      | Config, hash, error types                |

### Acceptance Criteria

- [x] `pnpm build` succeeds
- [x] `pnpm test` runs unit tests
- [x] Config loads from .env
- [x] Can query SOL balance from devnet
- [x] SQLite DB creates on startup

### Dependencies

- None (first milestone)

---

## Milestone 2: Pipes Core

> Pipe entity, static decider, execution engine, manual trigger.

### Deliverables

- [x] Pipe CRUD operations
- [x] Static decider implementation
- [x] Execution engine (decide → execute → record)
- [x] Manual trigger API

### Tasks

| Task                           | Effort | Description                                |
| ------------------------------ | ------ | ------------------------------------------ |
| **M2.1** Core types            | S      | Pipe, Destination, Distribution types      |
| **M2.2** Pipe validation       | S      | Validate destinations sum to 10000 bps     |
| **M2.3** Static decider        | M      | Split logic, remainder handling            |
| **M2.4** Decider registry      | S      | Type → implementation mapping              |
| **M2.5** Pipe service          | M      | create, get, update, delete, list          |
| **M2.6** Execution entity      | S      | Execution type, status enum                |
| **M2.7** Execution service     | M      | Create, update, query executions           |
| **M2.8** Execute flow          | L      | Build context → decide → transfer → record |
| **M2.9** Manual trigger        | S      | `pipeService.trigger(id)`                  |
| **M2.10** Public API           | S      | `createBagpipe()` factory, exports         |
| **M2.11** Integration tests    | M      | Pipe CRUD, execution flow                  |
| **M2.12** Example: basic-split | S      | Working example script                     |

### Acceptance Criteria

- [x] Can create pipe with 3 destinations
- [x] Manual trigger distributes SOL correctly
- [x] Execution recorded in DB with status
- [x] `examples/basic-split.ts` runs against devnet

**Note:** Fee reservation for multi-transfer transactions is a known refinement needed.

### Dependencies

- M1 (Foundation)

---

## Milestone 3: Bags Integration

> Claim from Bags.fm positions into pipe escrow.

### Deliverables

- [ ] Bags service wrapper
- [ ] Claim aggregation (all positions)
- [ ] Claim-per-token support
- [ ] Claim tracking in DB

### Tasks

| Task                             | Effort | Description                              |
| -------------------------------- | ------ | ---------------------------------------- |
| **M3.1** Bags SDK setup          | S      | Install @bagsfm/bags-sdk, types          |
| **M3.2** BagsService class       | M      | Initialize SDK, connection               |
| **M3.3** getClaimablePositions   | S      | Wrap SDK method                          |
| **M3.4** claimAll                | M      | Iterate positions, claim, return results |
| **M3.5** claimForToken           | M      | Filter by mint, then claim               |
| **M3.6** Position classification | S      | Detect V1/V2/regular positions           |
| **M3.7** Claims table            | S      | Add to schema, track claims              |
| **M3.8** Claim recording         | S      | Record each claim in DB                  |
| **M3.9** Claim → Execute         | M      | After claim, trigger pipe execution      |
| **M3.10** Integration tests      | M      | Mock Bags SDK, test flow                 |
| **M3.11** Example: bags-redirect | M      | Claim + redirect to charity              |

### Acceptance Criteria

- [ ] Can query claimable positions for wallet
- [ ] Claim all positions in one call
- [ ] Claims recorded in DB with amounts
- [ ] Claim triggers pipe execution automatically
- [ ] `examples/bags-redirect.ts` works

### Dependencies

- M2 (Pipes Core)

---

## Milestone 4: Lambda Deciders

> User-defined decision logic with effects.

### Deliverables

- [ ] Lambda decider runtime
- [ ] DeciderContext with effects
- [ ] Timeout handling
- [ ] Example decider functions

### Tasks

| Task                            | Effort | Description                           |
| ------------------------------- | ------ | ------------------------------------- |
| **M4.1** DeciderContext         | M      | Full context shape with effects       |
| **M4.2** DeciderEffects         | M      | fetch, readPipe, now()                |
| **M4.3** Lambda decider         | M      | Execute user function with timeout    |
| **M4.4** Result validation      | S      | Check no overspend                    |
| **M4.5** Timeout error          | S      | DeciderTimeoutError handling          |
| **M4.6** Function serialization | M      | Store/load function body (careful!)   |
| **M4.7** Example: time-based    | S      | Weekday/weekend routing               |
| **M4.8** Example: price-based   | M      | Fetch SOL price, conditional          |
| **M4.9** Example: accumulate    | S      | Hold until threshold, then release    |
| **M4.10** Unit tests            | M      | Lambda execution, timeout, validation |
| **M4.11** Update examples       | S      | Add lambda examples                   |

### Acceptance Criteria

- [ ] Lambda decider executes user function
- [ ] Fetch works inside decider
- [ ] Timeout kills runaway deciders
- [ ] Overspend rejected with error
- [ ] Examples demonstrate I/O effects

### Dependencies

- M2 (Pipes Core)

---

## Milestone 5: Scheduling & Retry

> Automated triggers, exponential backoff, escape hatch.

### Deliverables

- [ ] Threshold trigger
- [ ] Cron trigger
- [ ] Scheduler service with tick loop
- [ ] Retry with exponential backoff
- [ ] Manual claim escape hatch

### Tasks

| Task                          | Effort | Description                           |
| ----------------------------- | ------ | ------------------------------------- |
| **M5.1** TriggerMode types    | S      | threshold, cron definitions           |
| **M5.2** Scheduler service    | M      | tick() checks all pipes               |
| **M5.3** Threshold evaluation | S      | Balance >= threshold?                 |
| **M5.4** Cron evaluation      | S      | Time since last >= interval?          |
| **M5.5** Tick loop            | S      | setInterval with error handling       |
| **M5.6** RetryPolicy type     | S      | maxRetries, delays, multiplier        |
| **M5.7** Retry utility        | M      | withRetry() with backoff              |
| **M5.8** Execution retry      | M      | Failed → retrying state, next attempt |
| **M5.9** Retry scheduling     | M      | Track nextRetryAt, pick up on tick    |
| **M5.10** Manual claim        | M      | Escape hatch: drain escrow to owner   |
| **M5.11** Integration tests   | M      | Threshold trigger, retry flow         |

### Acceptance Criteria

- [ ] Pipe auto-triggers at threshold
- [ ] Cron trigger fires on schedule
- [ ] Failed execution retries with backoff
- [ ] After max retries, stays failed
- [ ] User can manually claim from failed pipe

### Dependencies

- M3 (Bags Integration) - for real claims to trigger on
- M4 (Lambda) - deciders that can fail

---

## Milestone 6: Recursion

> Pipes outputting to other pipes.

### Deliverables

- [ ] Pipe-to-pipe destinations
- [ ] Recursive execution
- [ ] Depth limiting
- [ ] Cycle detection

### Tasks

| Task                               | Effort | Description                        |
| ---------------------------------- | ------ | ---------------------------------- |
| **M6.1** Pipe destination type     | S      | destinationType: 'pipe'            |
| **M6.2** Resolve pipe dest         | M      | Look up target pipe, get escrow    |
| **M6.3** Recursive execute         | M      | After transfer to pipe, trigger it |
| **M6.4** Depth tracking            | S      | Pass depth through execution       |
| **M6.5** Depth limit               | S      | RecursionDepthExceededError at max |
| **M6.6** Cycle detection           | M      | Track visited pipes in execution   |
| **M6.7** Cycle error               | S      | CycleDetectedError with path       |
| **M6.8** Example: nested-royalties | M      | A → B → [C, D] chain               |
| **M6.9** Integration tests         | M      | Recursion, depth limit, cycles     |

### Acceptance Criteria

- [ ] Pipe A can send to Pipe B
- [ ] Recursive chains execute correctly
- [ ] Depth > 8 throws error
- [ ] A → B → A cycle detected and rejected
- [ ] Example demonstrates 3-level nesting

### Dependencies

- M2 (Pipes Core)
- M5 (Scheduling) - for proper execution tracking

---

## Post-MVP: Production Hardening

> Not milestones, but tracked for future.

| Item                | Description                           |
| ------------------- | ------------------------------------- |
| Postgres adapter    | Switch from SQLite for production     |
| Migrations          | Drizzle migration workflow            |
| Metrics             | Prometheus/OpenTelemetry              |
| Alerting            | Failed execution notifications        |
| Rate limiting       | Internal rate limits on Bags calls    |
| Mjolnir integration | Replace lambda stub with real microVM |
| Multi-token         | Handle SPL tokens, not just SOL       |
| Webhooks            | Notify external systems on events     |

---

## Dependency Graph

```
M1: Foundation
     │
     ▼
M2: Pipes Core ─────────────────────────┐
     │                                  │
     ├─────────────┐                    │
     ▼             ▼                    ▼
M3: Bags      M4: Lambda           M6: Recursion
     │             │
     └──────┬──────┘
            ▼
      M5: Scheduling
```

**Critical path**: M1 → M2 → M3 → M5

**Parallel work possible**:

- M4 (Lambda) can start after M2, parallel to M3
- M6 (Recursion) can start after M2, parallel to M3/M4

---

## Effort Legend

| Size  | Meaning | Rough scope                    |
| ----- | ------- | ------------------------------ |
| **S** | Small   | Single function/file, <1hr     |
| **M** | Medium  | Multiple files, tests, 1-4hrs  |
| **L** | Large   | Significant integration, >4hrs |

---

## Working Agreement

1. **One milestone at a time** - Complete before starting next (on critical path)
2. **Tests with code** - Don't merge without tests for new functionality
3. **Examples are docs** - Keep examples working and up-to-date
4. **Errors are typed** - New failure modes get proper error types

---

## Getting Started

```bash
# Start with M1.1
pnpm init
# ... follow M1 tasks sequentially

# After M1 complete, start M2
# After M2 complete, M3/M4 can run in parallel
```

Ready to begin with Milestone 1?
