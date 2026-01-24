# Bagpipe: Programmable Token Flow Router

> A transistor for money. Escrow-based routing layer for Solana token streams with Turing-complete decision logic.

## Overview

Bagpipe enables programmable routing of token flows on Solana. Primary use case: redirecting [Bags.fm](https://bags.fm) creator royalties to configurable destinations with arbitrary logic.

**Core metaphor**: A pipe. Input flows in, decision logic determines where it goes, output flows out. Pipes can connect to other pipes, forming a DAG of money flows.

```
     ┌─────────────────────────────────────────────────────┐
     │                      BAGPIPE                        │
     │                                                     │
     │   INPUT ──▶ [ ESCROW ] ──▶ [ DECIDER ] ──▶ OUTPUT  │
     │              (vault)        (lambda)      (pipe|wallet)
     │                                                     │
     └─────────────────────────────────────────────────────┘
```

## Design Principles

1. **Pipes are composable** - Output of one pipe can be input to another
2. **Inputs ≈ Outputs** - Same trait/interface; it's all token movement
3. **Decider is Turing-complete** - Arbitrary logic with I/O effects
4. **Security at the edges** - Handled by infrastructure layer, not here
5. **Custody is explicit** - Bagpipe controls escrow wallets via injected keys

---

## Architecture

### System Context

```
┌──────────────────────────────────────────────────────────────────────┐
│                           INFRASTRUCTURE                             │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐  │
│  │  Key Injection │  │  Attestation   │  │  Mjolnir (future)      │  │
│  │  (env vars)    │  │  (signed)      │  │  microVM compute       │  │
│  └───────┬────────┘  └───────┬────────┘  └───────────┬────────────┘  │
└──────────┼───────────────────┼───────────────────────┼───────────────┘
           │                   │                       │
           ▼                   ▼                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                            BAGPIPE                                   │
│                                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│  │   Ingest    │───▶│   Escrow    │───▶│   Route     │              │
│  │  (claim)    │    │  (custody)  │    │  (decide)   │              │
│  └─────────────┘    └─────────────┘    └─────────────┘              │
│         ▲                                     │                      │
│         │                                     ▼                      │
│  ┌──────┴──────┐                      ┌─────────────┐               │
│  │ Bags.fm API │                      │   Execute   │               │
│  │ (claims)    │                      │  (transfer) │               │
│  └─────────────┘                      └──────┬──────┘               │
│                                              │                       │
└──────────────────────────────────────────────┼───────────────────────┘
                                               ▼
                              ┌────────────────────────────────┐
                              │  DESTINATIONS                  │
                              │  • Wallets                     │
                              │  • Programs                    │
                              │  • Other Pipes (recursion)     │
                              └────────────────────────────────┘
```

### Core Entities

#### Pipe

The fundamental unit. Represents a routing configuration.

```typescript
interface Pipe {
	id: string; // unique identifier (blake3 hash of config?)
	name?: string; // human-readable

	// Custody
	escrowWallet: PublicKey; // PDA or injected wallet
	controllerType: ControllerType;
	controllerId: string; // wallet pubkey | program id | mjolnir fn

	// Routing
	decider: Decider;
	destinations: Destination[]; // static fallback if decider fails

	// Execution
	triggerMode: TriggerMode;
	retryPolicy: RetryPolicy;

	// Metadata
	createdAt: number;
	updatedAt: number;
}

type ControllerType =
	| 'wallet' // human wallet signs
	| 'multisig' // M-of-N PDA
	| 'program' // Solana program (CPI)
	| 'mjolnir'; // off-chain compute attestation

type TriggerMode =
	| { type: 'manual' }
	| { type: 'threshold'; amountLamports: bigint }
	| { type: 'cron'; intervalMs: number }
	| { type: 'event'; eventType: string };
```

#### Destination

Where tokens flow to. Can be terminal (wallet) or recursive (another pipe).

```typescript
interface Destination {
	address: PublicKey;
	destinationType: DestinationType;
	shareBps: number; // basis points, 10000 = 100%
	minAmount?: bigint; // optional dust threshold
}

type DestinationType = 'wallet' | 'program' | 'pipe'; // recursive!
```

#### Decider

The brain. Determines routing at execution time.

```typescript
interface Decider {
	type: DeciderType;
	config: DeciderConfig;
}

type DeciderType =
	| 'static' // use destinations as configured
	| 'lambda' // inline function (stub for mjolnir)
	| 'mjolnir'; // future: full microVM execution

interface DeciderConfig {
	// For lambda/mjolnir
	functionId?: string;
	timeout?: number;

	// For static
	destinations?: Destination[];
}

// Decider function signature (lambda or mjolnir)
type DeciderFn = (ctx: DeciderContext) => Promise<DeciderResult>;

interface DeciderContext {
	pipeId: string;
	escrowBalance: bigint;
	splBalances: Map<string, bigint>; // mint → amount
	triggerType: TriggerMode['type'];
	timestamp: number;

	// I/O capabilities (effects)
	fetch: typeof fetch; // HTTP
	readPipe: (id: string) => Promise<Pipe>;
	// ... more as needed
}

interface DeciderResult {
	distributions: Distribution[];
	attestation?: string; // signed proof of decision
}

interface Distribution {
	destination: PublicKey;
	amount: bigint;
	mint?: PublicKey; // SOL if undefined
}
```

#### Execution

Record of a pipe execution.

```typescript
interface Execution {
	id: string;
	pipeId: string;
	triggeredAt: number;
	completedAt?: number;

	status: ExecutionStatus;

	input: {
		balanceBefore: bigint;
		splBalancesBefore: Map<string, bigint>;
	};

	decision?: DeciderResult;

	output?: {
		transactions: string[]; // tx signatures
		distributions: Distribution[];
	};

	error?: {
		message: string;
		retryCount: number;
		nextRetryAt?: number;
	};
}

type ExecutionStatus = 'pending' | 'deciding' | 'executing' | 'completed' | 'failed' | 'retrying';
```

---

## Flows

### 1. Claim & Route (Bags Integration)

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. CLAIM                                                            │
│                                                                     │
│    Bags.fm ───[getAllClaimablePositions]──▶ positions[]             │
│                                                                     │
│    For each position:                                               │
│      ├── getClaimTransaction(escrowWallet, position)                │
│      ├── sign with escrow key                                       │
│      └── submit to Solana                                           │
│                                                                     │
│    Result: SOL now in escrowWallet                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. TRIGGER CHECK                                                    │
│                                                                     │
│    Check triggerMode:                                               │
│      ├── threshold: balance >= threshold? proceed : wait           │
│      ├── cron: time >= lastExecution + interval? proceed : wait    │
│      ├── manual: explicit call? proceed                             │
│      └── event: matching event? proceed                             │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. DECIDE                                                           │
│                                                                     │
│    Build DeciderContext from current state                          │
│                                                                     │
│    If decider.type == 'static':                                     │
│      └── distributions = destinations.map(d => { d.address,         │
│                            amount: balance * d.shareBps / 10000 })  │
│                                                                     │
│    If decider.type == 'lambda':                                     │
│      └── distributions = await lambdaFn(ctx)                        │
│                                                                     │
│    If decider.type == 'mjolnir':                                    │
│      └── distributions = await mjolnir.invoke(fn, ctx)              │
│          (with signed attestation)                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. EXECUTE                                                          │
│                                                                     │
│    For each distribution:                                           │
│      ├── If dest is wallet/program: transfer(escrow → dest)         │
│      └── If dest is pipe: deposit into that pipe's escrow           │
│                                                                     │
│    Sign all txns with escrow key                                    │
│    Submit batch to Solana                                           │
│                                                                     │
│    On failure:                                                      │
│      └── exponentialBackoff(retryCount)                             │
│          User can manually claim via fallback                       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. LOG                                                              │
│                                                                     │
│    Record Execution with all details                                │
│    Emit events for indexing                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### 2. Recursive Piping

When a destination is another pipe:

```
Pipe A                      Pipe B                      Final
───────                     ───────                     ─────

escrow ──▶ decide ──┐       escrow ──▶ decide ──┐
                    │                           │
                    └──▶ Pipe B.escrow          └──▶ Wallet X (60%)
                         (triggers B)                Wallet Y (40%)
```

**Depth limit**: Configurable, default 8 hops to prevent infinite loops.

---

## Bags.fm Integration

### Claiming Flow

```typescript
// Using @bagsfm/bags-sdk

async function claimAllToPipe(
	pipeId: string,
	escrowKeypair: Keypair,
	sdk: BagsSDK
): Promise<ClaimResult> {
	// 1. Get all claimable positions for escrow wallet
	const positions = await sdk.fee.getAllClaimablePositions(escrowKeypair.publicKey);

	if (positions.length === 0) {
		return { claimed: 0, transactions: [] };
	}

	const txSignatures: string[] = [];

	// 2. Claim each position
	for (const position of positions) {
		const claimTxns = await sdk.fee.getClaimTransaction(escrowKeypair.publicKey, position);

		for (const tx of claimTxns) {
			const sig = await signAndSendTransaction(
				sdk.state.getConnection(),
				sdk.state.getCommitment(),
				tx,
				escrowKeypair
			);
			txSignatures.push(sig);
		}
	}

	return {
		claimed: positions.length,
		transactions: txSignatures
	};
}
```

### Setting Up a Bags → Pipe Flow

1. User creates Pipe with escrowWallet
2. User sets escrowWallet as their Bags creator wallet (or co-founder)
3. Bagpipe periodically claims from Bags → escrow
4. Decider routes to configured destinations

---

## Mjolnir Stub (Lambda Implementation)

For initial implementation, stub Mjolnir with simple lambda execution:

```typescript
// Stub implementation - runs locally
class LambdaDecider implements Decider {
	type = 'lambda' as const;

	constructor(private fn: DeciderFn) {}

	async decide(ctx: DeciderContext): Promise<DeciderResult> {
		// Just run the function directly
		// In production Mjolnir: this would be sandboxed microVM execution
		return await this.fn(ctx);
	}
}

// Example decider functions

// Split 50/50
const splitFiftyFifty: DeciderFn = async (ctx) => {
	const half = ctx.escrowBalance / 2n;
	return {
		distributions: [
			{ destination: WALLET_A, amount: half },
			{ destination: WALLET_B, amount: ctx.escrowBalance - half }
		]
	};
};

// Time-based: charity on weekends, me on weekdays
const weekendCharity: DeciderFn = async (ctx) => {
	const day = new Date(ctx.timestamp).getDay();
	const isWeekend = day === 0 || day === 6;

	return {
		distributions: [
			{
				destination: isWeekend ? CHARITY_WALLET : MY_WALLET,
				amount: ctx.escrowBalance
			}
		]
	};
};

// Dynamic: check price feed, route based on conditions
const priceBasedRoute: DeciderFn = async (ctx) => {
	const res = await ctx.fetch(
		'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
	);
	const {
		solana: { usd: price }
	} = await res.json();

	// If SOL > $200, take profits; otherwise accumulate
	if (price > 200) {
		return {
			distributions: [{ destination: PROFIT_WALLET, amount: ctx.escrowBalance }]
		};
	}

	// Hold - don't distribute
	return { distributions: [] };
};
```

---

## Retry & Fallback

```typescript
interface RetryPolicy {
	maxRetries: number; // default: 5
	initialDelayMs: number; // default: 1000
	maxDelayMs: number; // default: 60000
	backoffMultiplier: number; // default: 2
}

function calculateNextRetry(policy: RetryPolicy, attempt: number): number {
	const delay = Math.min(
		policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt),
		policy.maxDelayMs
	);
	// Add jitter: ±10%
	const jitter = delay * 0.1 * (Math.random() * 2 - 1);
	return delay + jitter;
}

// User manual claim (escape hatch)
async function manualClaim(pipeId: string, userWallet: Keypair): Promise<void> {
	const pipe = await getPipe(pipeId);

	// Verify user is authorized (controller or fallback)
	if (!isAuthorized(userWallet.publicKey, pipe)) {
		throw new Error('Unauthorized');
	}

	// Transfer entire balance to user
	await transfer(pipe.escrowWallet, userWallet.publicKey, 'all');
}
```

---

## Hashing

Using **Blake3** for all content-addressed / verification needs:

```typescript
import { blake3 } from '@noble/hashes/blake3';

function hashPipeConfig(pipe: Pipe): string {
	const canonical = JSON.stringify({
		escrowWallet: pipe.escrowWallet.toBase58(),
		controllerType: pipe.controllerType,
		controllerId: pipe.controllerId,
		decider: pipe.decider,
		destinations: pipe.destinations
	});

	return Buffer.from(blake3(canonical)).toString('hex');
}

function hashAttestation(decision: DeciderResult, timestamp: number): string {
	const data = JSON.stringify({ decision, timestamp });
	return Buffer.from(blake3(data)).toString('hex');
}
```

---

## API Surface

### Pipe Management

```typescript
interface PipeService {
	// CRUD
	create(config: CreatePipeInput): Promise<Pipe>;
	get(id: string): Promise<Pipe | null>;
	update(id: string, updates: UpdatePipeInput): Promise<Pipe>;
	delete(id: string): Promise<void>;

	// Query
	list(filter?: PipeFilter): Promise<Pipe[]>;
	listByController(controllerId: string): Promise<Pipe[]>;

	// Execution
	trigger(id: string): Promise<Execution>;
	getExecutions(pipeId: string): Promise<Execution[]>;

	// Escape hatch
	manualClaim(pipeId: string, signer: Keypair): Promise<string>;
}
```

### Bags Integration

```typescript
interface BagsService {
	// Query
	getClaimablePositions(wallet: PublicKey): Promise<ClaimablePosition[]>;
	getTokenCreators(mint: PublicKey): Promise<Creator[]>;

	// Actions
	claimAll(wallet: Keypair): Promise<ClaimResult>;
	claimForToken(wallet: Keypair, mint: PublicKey): Promise<ClaimResult>;
}
```

---

## Project Structure

```
bagpipe/
├── DESIGN.md                    # This document
├── README.md                    # Usage & quickstart
├── package.json
├── tsconfig.json
│
├── src/
│   ├── index.ts                 # Public API exports
│   │
│   ├── core/
│   │   ├── pipe.ts              # Pipe entity & operations
│   │   ├── destination.ts       # Destination types
│   │   ├── decider.ts           # Decider interface & implementations
│   │   ├── execution.ts         # Execution tracking
│   │   └── types.ts             # Shared types
│   │
│   ├── services/
│   │   ├── pipe-service.ts      # Pipe CRUD & execution
│   │   ├── bags-service.ts      # Bags.fm integration
│   │   ├── solana-service.ts    # Solana RPC & transactions
│   │   └── scheduler.ts         # Cron/threshold triggers
│   │
│   ├── deciders/
│   │   ├── static.ts            # Static split decider
│   │   ├── lambda.ts            # Lambda stub (mjolnir placeholder)
│   │   └── examples/            # Example decider functions
│   │       ├── split.ts
│   │       ├── time-based.ts
│   │       └── price-based.ts
│   │
│   ├── storage/
│   │   ├── interface.ts         # Storage abstraction
│   │   ├── memory.ts            # In-memory (dev)
│   │   └── postgres.ts          # Postgres (prod)
│   │
│   └── utils/
│       ├── hash.ts              # Blake3 utilities
│       ├── retry.ts             # Exponential backoff
│       └── solana.ts            # Solana helpers
│
├── tests/
│   ├── unit/
│   └── integration/
│
└── examples/
    ├── basic-split.ts
    ├── bags-redirect.ts
    └── recursive-pipes.ts
```

---

## Implementation Phases

### Phase 1: Core Pipe Mechanics

- [ ] Pipe entity & types
- [ ] Static decider (fixed splits)
- [ ] In-memory storage
- [ ] Basic execution flow
- [ ] Manual trigger only

### Phase 2: Bags Integration

- [ ] Bags SDK integration
- [ ] Claim aggregation
- [ ] Escrow wallet management
- [ ] Claim → route flow

### Phase 3: Lambda Deciders

- [ ] Lambda decider stub
- [ ] Decider context with fetch
- [ ] Example decider functions
- [ ] Attestation generation

### Phase 4: Scheduling & Retry

- [ ] Threshold triggers
- [ ] Cron triggers
- [ ] Exponential backoff
- [ ] Manual claim escape hatch

### Phase 5: Recursion

- [ ] Pipe-to-pipe destinations
- [ ] Depth limiting
- [ ] Cycle detection

### Phase 6: Production Hardening

- [ ] Postgres storage
- [ ] Proper logging/metrics
- [ ] Mjolnir integration (when ready)

---

## Open Questions

1. **Pipe identity**: Hash of config, or UUID? Tradeoffs around immutability.
2. **Multi-token handling**: Single pipe per token, or one pipe handles all SPL tokens?
3. **Gas/rent**: Who pays for claim transactions? Deduct from escrow?
4. **Monitoring**: Alerting on failed executions? Webhook support?

---

## References

- [Bags.fm API Docs](https://docs.bags.fm/)
- [Bags SDK](https://github.com/bagsfm/bags-sdk)
- [Solana Web3.js](https://solana.com/docs/clients/javascript)
- [Blake3](https://github.com/BLAKE3-team/BLAKE3)
