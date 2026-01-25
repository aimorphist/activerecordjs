# Bagpipe Architecture

> Technical specification for implementing the Bagpipe token routing system.

**Prerequisite**: Read [DESIGN.md](./DESIGN.md) first for concepts and flows.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Storage Schema](#storage-schema)
4. [Solana Integration](#solana-integration)
5. [Bags SDK Integration](#bags-sdk-integration)
6. [Decider Runtime](#decider-runtime)
7. [Scheduler](#scheduler)
8. [Configuration](#configuration)
9. [Error Handling](#error-handling)
10. [Testing Strategy](#testing-strategy)
11. [Observability](#observability)

---

## Tech Stack

### Runtime

| Component       | Choice             | Rationale                                       |
| --------------- | ------------------ | ----------------------------------------------- |
| Runtime         | **Node.js 20+**    | Bags SDK is TypeScript; async I/O for RPC calls |
| Language        | **TypeScript 5.x** | Type safety, Solana ecosystem standard          |
| Package Manager | **bun**            | Fast, disk-efficient, good monorepo support     |

### Core Dependencies

```
@solana/web3.js       - Solana RPC, transactions, keypairs
@bagsfm/bags-sdk      - Bags.fm API client
bs58                  - Base58 encoding for keys
@noble/hashes         - Blake3 hashing (audited, fast)
zod                   - Runtime validation, config parsing
```

### Storage

| Environment | Choice           | Rationale                                      |
| ----------- | ---------------- | ---------------------------------------------- |
| Development | **SQLite**       | Zero config, file-based, fast iteration        |
| Production  | **Postgres 15+** | JSONB for flexible schemas, proven reliability |

ORM: **Drizzle** - Type-safe, lightweight, good migration story.

### Optional/Future

```
bullmq               - Job queue for scheduled triggers (if needed)
pino                 - Structured logging
opentelemetry        - Tracing (when we need it)
```

---

## Project Structure

```
bagpipe/
├── package.json
├── tsconfig.json
├── drizzle.config.ts          # DB migrations config
├── .env.example
│
├── src/
│   ├── index.ts               # Public API: createBagpipe(), types
│   │
│   ├── core/                  # Domain logic, no I/O
│   │   ├── pipe.ts            # Pipe entity, validation
│   │   ├── destination.ts     # Destination types
│   │   ├── decider.ts         # Decider interface
│   │   ├── execution.ts       # Execution entity
│   │   ├── distribution.ts    # Distribution calculation
│   │   └── types.ts           # Shared types, enums
│   │
│   ├── deciders/              # Decider implementations
│   │   ├── static.ts          # Fixed split ratios
│   │   ├── lambda.ts          # User-provided function
│   │   └── registry.ts        # Decider type → implementation
│   │
│   ├── services/              # I/O, orchestration
│   │   ├── pipe-service.ts    # Pipe CRUD, trigger orchestration
│   │   ├── execution-service.ts
│   │   ├── bags-service.ts    # Bags.fm claiming
│   │   ├── solana-service.ts  # RPC, tx submission
│   │   ├── wallet-service.ts  # Key management abstraction
│   │   └── scheduler-service.ts
│   │
│   ├── storage/               # Persistence
│   │   ├── interface.ts       # Storage port (abstract)
│   │   ├── schema.ts          # Drizzle schema
│   │   ├── sqlite.ts          # SQLite adapter
│   │   ├── postgres.ts        # Postgres adapter
│   │   └── migrations/        # Drizzle migrations
│   │
│   ├── config/
│   │   ├── index.ts           # Config loading, validation
│   │   ├── schema.ts          # Zod schemas for config
│   │   └── defaults.ts        # Default values
│   │
│   └── utils/
│       ├── hash.ts            # Blake3 helpers
│       ├── retry.ts           # Exponential backoff
│       ├── result.ts          # Result<T, E> type
│       └── logger.ts          # Logging wrapper
│
├── tests/
│   ├── unit/                  # Pure function tests
│   ├── integration/           # With real DB, mocked Solana
│   └── e2e/                   # Against devnet (manual/CI)
│
└── examples/
    ├── basic-split.ts
    ├── bags-redirect.ts
    └── lambda-decider.ts
```

### Module Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                        PUBLIC API                           │
│  index.ts: createBagpipe(), Pipe, Decider, etc.            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        SERVICES                             │
│  Orchestration, I/O coordination                            │
│  Depends on: core, storage, external SDKs                   │
└─────────────────────────────────────────────────────────────┘
        │                     │                      │
        ▼                     ▼                      ▼
┌─────────────┐       ┌─────────────┐       ┌─────────────────┐
│    CORE     │       │   STORAGE   │       │   EXTERNAL      │
│  (pure)     │       │  (DB I/O)   │       │  (Solana, Bags) │
└─────────────┘       └─────────────┘       └─────────────────┘
```

**Rule**: `core/` has zero I/O. All side effects in `services/`.

---

## Storage Schema

### Drizzle Schema

```typescript
// src/storage/schema.ts

import { pgTable, text, timestamp, bigint, jsonb, boolean, integer } from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// PIPES
// ─────────────────────────────────────────────────────────────

export const pipes = pgTable('pipes', {
	id: text('id').primaryKey(), // blake3 hash or uuid
	name: text('name'),

	// Custody
	escrowWallet: text('escrow_wallet').notNull(), // base58 pubkey
	controllerType: text('controller_type').notNull(), // 'wallet' | 'multisig' | 'program' | 'mjolnir'
	controllerId: text('controller_id').notNull(), // pubkey or function id

	// Decider
	deciderType: text('decider_type').notNull(), // 'static' | 'lambda'
	deciderConfig: jsonb('decider_config').notNull(), // DeciderConfig

	// Static destinations (fallback if decider fails)
	destinations: jsonb('destinations').notNull(), // Destination[]

	// Trigger
	triggerMode: jsonb('trigger_mode').notNull(), // TriggerMode
	lastTriggeredAt: timestamp('last_triggered_at'),

	// Retry
	retryPolicy: jsonb('retry_policy'), // RetryPolicy | null

	// Metadata
	enabled: boolean('enabled').default(true),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow()
});

// ─────────────────────────────────────────────────────────────
// EXECUTIONS
// ─────────────────────────────────────────────────────────────

export const executions = pgTable('executions', {
	id: text('id').primaryKey(), // uuid
	pipeId: text('pipe_id')
		.references(() => pipes.id)
		.notNull(),

	status: text('status').notNull(), // ExecutionStatus

	// Trigger info
	triggerType: text('trigger_type').notNull(), // 'manual' | 'threshold' | 'cron'
	triggeredAt: timestamp('triggered_at').notNull(),

	// Pre-execution state
	balanceBefore: bigint('balance_before', { mode: 'bigint' }),
	splBalancesBefore: jsonb('spl_balances_before'), // Record<mint, amount>

	// Decision
	deciderResult: jsonb('decider_result'), // DeciderResult | null
	deciderDurationMs: integer('decider_duration_ms'),

	// Execution result
	distributions: jsonb('distributions'), // Distribution[] | null
	txSignatures: jsonb('tx_signatures'), // string[] | null

	completedAt: timestamp('completed_at'),

	// Error tracking
	errorMessage: text('error_message'),
	retryCount: integer('retry_count').default(0),
	nextRetryAt: timestamp('next_retry_at')
});

// ─────────────────────────────────────────────────────────────
// CLAIMS (Bags integration tracking)
// ─────────────────────────────────────────────────────────────

export const claims = pgTable('claims', {
	id: text('id').primaryKey(),
	pipeId: text('pipe_id')
		.references(() => pipes.id)
		.notNull(),

	// Source
	tokenMint: text('token_mint').notNull(), // Bags token
	positionType: text('position_type'), // 'virtual' | 'damm' | 'custom_vault'

	// Amounts
	amountLamports: bigint('amount_lamports', { mode: 'bigint' }).notNull(),

	// Transaction
	txSignature: text('tx_signature').notNull(),
	claimedAt: timestamp('claimed_at').notNull()
});

// ─────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────

// pipes: lookup by escrow wallet (for claim routing)
// CREATE INDEX idx_pipes_escrow ON pipes(escrow_wallet);

// executions: lookup by pipe, filter by status
// CREATE INDEX idx_executions_pipe_status ON executions(pipe_id, status);

// claims: aggregate by pipe
// CREATE INDEX idx_claims_pipe ON claims(pipe_id);
```

### JSONB Structures

```typescript
// Stored in deciderConfig
interface DeciderConfigStored {
	// For lambda
	functionBody?: string; // serialized function (careful!)
	functionId?: string; // reference to external fn
	timeout?: number;

	// For static - redundant with destinations, but explicit
	staticDestinations?: Destination[];
}

// Stored in destinations
interface DestinationStored {
	address: string; // base58
	destinationType: 'wallet' | 'program' | 'pipe';
	shareBps: number;
	minAmount?: string; // bigint as string
}

// Stored in triggerMode
type TriggerModeStored =
	| { type: 'manual' }
	| { type: 'threshold'; amountLamports: string }
	| { type: 'cron'; intervalMs: number }
	| { type: 'event'; eventType: string };
```

---

## Solana Integration

### Connection Management

```typescript
// src/services/solana-service.ts

interface SolanaServiceConfig {
	rpcUrl: string;
	commitment: Commitment; // 'processed' | 'confirmed' | 'finalized'
	maxRetries: number;
	retryDelayMs: number;
}

class SolanaService {
	private connection: Connection;

	constructor(private config: SolanaServiceConfig) {
		this.connection = new Connection(config.rpcUrl, {
			commitment: config.commitment,
			confirmTransactionInitialTimeout: 60_000
		});
	}

	// Get SOL balance
	async getBalance(pubkey: PublicKey): Promise<bigint> {
		const lamports = await this.connection.getBalance(pubkey);
		return BigInt(lamports);
	}

	// Get SPL token balances
	async getSplBalances(owner: PublicKey): Promise<Map<string, bigint>> {
		const accounts = await this.connection.getParsedTokenAccountsByOwner(owner, {
			programId: TOKEN_PROGRAM_ID
		});

		const balances = new Map<string, bigint>();
		for (const { account } of accounts.value) {
			const info = account.data.parsed.info;
			balances.set(info.mint, BigInt(info.tokenAmount.amount));
		}
		return balances;
	}

	// Sign and send transaction
	async signAndSend(
		tx: Transaction | VersionedTransaction,
		signer: Keypair,
		options?: { skipPreflight?: boolean }
	): Promise<string> {
		// ... implementation with retry logic
	}

	// Transfer SOL
	async transferSol(from: Keypair, to: PublicKey, lamports: bigint): Promise<string> {
		const tx = new Transaction().add(
			SystemProgram.transfer({
				fromPubkey: from.publicKey,
				toPubkey: to,
				lamports: Number(lamports) // safe if < 2^53
			})
		);
		return this.signAndSend(tx, from);
	}

	// Transfer SPL token
	async transferSpl(
		from: Keypair,
		to: PublicKey,
		mint: PublicKey,
		amount: bigint
	): Promise<string> {
		// ... ATA creation if needed, then transfer
	}
}
```

### Wallet Service (Key Management Abstraction)

```typescript
// src/services/wallet-service.ts

interface WalletService {
	// Get keypair for a pipe's escrow
	getEscrowKeypair(pipeId: string): Promise<Keypair>;

	// Check if we control this wallet
	hasAccess(pubkey: PublicKey): Promise<boolean>;
}

// Implementation: Environment variable injection
class EnvWalletService implements WalletService {
	private cache = new Map<string, Keypair>();

	async getEscrowKeypair(pipeId: string): Promise<Keypair> {
		// Convention: ESCROW_KEY_<pipeId> = base58 private key
		const envKey = `ESCROW_KEY_${pipeId}`;
		const secretKey = process.env[envKey];

		if (!secretKey) {
			throw new WalletNotFoundError(pipeId);
		}

		if (!this.cache.has(pipeId)) {
			const keypair = Keypair.fromSecretKey(bs58.decode(secretKey));
			this.cache.set(pipeId, keypair);
		}

		return this.cache.get(pipeId)!;
	}

	async hasAccess(pubkey: PublicKey): Promise<boolean> {
		// Check all ESCROW_KEY_* env vars
		for (const [key, value] of Object.entries(process.env)) {
			if (key.startsWith('ESCROW_KEY_') && value) {
				try {
					const kp = Keypair.fromSecretKey(bs58.decode(value));
					if (kp.publicKey.equals(pubkey)) return true;
				} catch {}
			}
		}
		return false;
	}
}

// Future: Mjolnir-injected keys, HSM, etc.
```

### Transaction Building Patterns

```typescript
// For batching multiple transfers
async function buildDistributionTx(
	from: PublicKey,
	distributions: Distribution[],
	recentBlockhash: string
): Promise<Transaction> {
	const tx = new Transaction({ recentBlockhash, feePayer: from });

	for (const dist of distributions) {
		if (dist.mint) {
			// SPL transfer
			tx.add(createTransferInstruction(/* ... */));
		} else {
			// SOL transfer
			tx.add(
				SystemProgram.transfer({
					fromPubkey: from,
					toPubkey: dist.destination,
					lamports: Number(dist.amount)
				})
			);
		}
	}

	return tx;
}
```

---

## Bags SDK Integration

### Service Layer

```typescript
// src/services/bags-service.ts

import { BagsSDK, signAndSendTransaction } from '@bagsfm/bags-sdk';

interface BagsServiceConfig {
	apiKey: string;
	rpcUrl: string;
	commitment: Commitment;
}

class BagsService {
	private sdk: BagsSDK;

	constructor(config: BagsServiceConfig) {
		const connection = new Connection(config.rpcUrl);
		this.sdk = new BagsSDK(config.apiKey, connection, config.commitment);
	}

	// Get all claimable positions for a wallet
	async getClaimablePositions(wallet: PublicKey): Promise<ClaimablePosition[]> {
		return this.sdk.fee.getAllClaimablePositions(wallet);
	}

	// Claim all positions, return results
	async claimAll(escrowKeypair: Keypair): Promise<ClaimResult> {
		const positions = await this.getClaimablePositions(escrowKeypair.publicKey);

		if (positions.length === 0) {
			return { positionsClaimed: 0, totalLamports: 0n, txSignatures: [] };
		}

		const txSignatures: string[] = [];
		let totalLamports = 0n;

		for (const position of positions) {
			const claimTxns = await this.sdk.fee.getClaimTransaction(escrowKeypair.publicKey, position);

			for (const tx of claimTxns) {
				try {
					const sig = await signAndSendTransaction(
						this.sdk.state.getConnection(),
						this.sdk.state.getCommitment(),
						tx,
						escrowKeypair
					);
					txSignatures.push(sig);

					// Estimate claimed amount from position
					totalLamports += this.estimatePositionValue(position);
				} catch (err) {
					// Log but continue with other positions
					console.error(`Failed to claim position: ${err}`);
				}
			}
		}

		return {
			positionsClaimed: positions.length,
			totalLamports,
			txSignatures
		};
	}

	// Claim for specific token only
	async claimForToken(escrowKeypair: Keypair, tokenMint: PublicKey): Promise<ClaimResult> {
		const allPositions = await this.getClaimablePositions(escrowKeypair.publicKey);
		const positions = allPositions.filter((p) => p.baseMint === tokenMint.toBase58());
		// ... same claim logic
	}

	private estimatePositionValue(position: ClaimablePosition): bigint {
		// Sum all claimable amounts from position
		let total = 0n;
		if (position.virtualPoolClaimableAmount) {
			total += BigInt(position.virtualPoolClaimableAmount);
		}
		if (position.dammPoolClaimableAmount) {
			total += BigInt(position.dammPoolClaimableAmount);
		}
		// Handle custom vault...
		return total;
	}
}

interface ClaimResult {
	positionsClaimed: number;
	totalLamports: bigint;
	txSignatures: string[];
}
```

### Position Types Mapping

```typescript
// Bags position types we handle

type BagsPositionType =
	| 'regular' // No custom fee vault
	| 'custom_v1' // Fee Share V1 (A/B claimers)
	| 'custom_v2_pre' // Fee Share V2, pre-migration
	| 'custom_v2_post'; // Fee Share V2, post-migration (DAMM)

function classifyPosition(position: ClaimablePosition): BagsPositionType {
	if (!position.isCustomFeeVault) return 'regular';

	if (position.programId === 'FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi') {
		return 'custom_v1';
	}

	if (position.isMigrated) {
		return 'custom_v2_post';
	}

	return 'custom_v2_pre';
}
```

---

## Decider Runtime

### Interface

```typescript
// src/core/decider.ts

interface DeciderContext {
	pipeId: string;
	escrowWallet: PublicKey;
	escrowBalance: bigint; // SOL lamports
	splBalances: Map<string, bigint>; // mint → amount

	trigger: {
		type: 'manual' | 'threshold' | 'cron' | 'event';
		timestamp: number;
	};

	// Previous execution info
	lastExecution?: {
		completedAt: number;
		distributions: Distribution[];
	};

	// I/O effects (only for lambda/mjolnir)
	effects: DeciderEffects;
}

interface DeciderEffects {
	fetch: typeof fetch; // HTTP requests
	readPipe: (id: string) => Promise<Pipe | null>;
	now: () => number; // Current timestamp
}

interface DeciderResult {
	distributions: Distribution[];
	metadata?: Record<string, unknown>; // For logging/debugging
}

interface Decider {
	readonly type: 'static' | 'lambda';
	decide(ctx: DeciderContext): Promise<DeciderResult>;
}
```

### Static Decider

```typescript
// src/deciders/static.ts

class StaticDecider implements Decider {
	readonly type = 'static';

	constructor(private destinations: Destination[]) {
		this.validateDestinations();
	}

	private validateDestinations() {
		const totalBps = this.destinations.reduce((sum, d) => sum + d.shareBps, 0);
		if (totalBps !== 10000) {
			throw new Error(`Destinations must sum to 10000 bps, got ${totalBps}`);
		}
	}

	async decide(ctx: DeciderContext): Promise<DeciderResult> {
		const distributions: Distribution[] = [];
		let remaining = ctx.escrowBalance;

		for (let i = 0; i < this.destinations.length; i++) {
			const dest = this.destinations[i];
			const isLast = i === this.destinations.length - 1;

			// Last destination gets remainder to avoid rounding dust
			const amount = isLast ? remaining : (ctx.escrowBalance * BigInt(dest.shareBps)) / 10000n;

			// Skip if below min
			if (dest.minAmount && amount < dest.minAmount) {
				continue;
			}

			distributions.push({
				destination: new PublicKey(dest.address),
				amount,
				mint: undefined // SOL only for now
			});

			remaining -= amount;
		}

		return { distributions };
	}
}
```

### Lambda Decider (Mjolnir Stub)

```typescript
// src/deciders/lambda.ts

type LambdaFn = (ctx: DeciderContext) => Promise<DeciderResult>;

class LambdaDecider implements Decider {
	readonly type = 'lambda';

	constructor(
		private fn: LambdaFn,
		private options: { timeout?: number } = {}
	) {}

	async decide(ctx: DeciderContext): Promise<DeciderResult> {
		const timeout = this.options.timeout ?? 30_000;

		// Race against timeout
		const result = await Promise.race([this.fn(ctx), this.timeoutPromise(timeout)]);

		// Validate result
		this.validateResult(result, ctx);

		return result;
	}

	private timeoutPromise(ms: number): Promise<never> {
		return new Promise((_, reject) => {
			setTimeout(() => reject(new DeciderTimeoutError(ms)), ms);
		});
	}

	private validateResult(result: DeciderResult, ctx: DeciderContext) {
		const totalDistributed = result.distributions.reduce((sum, d) => sum + d.amount, 0n);

		if (totalDistributed > ctx.escrowBalance) {
			throw new DeciderOverspendError(totalDistributed, ctx.escrowBalance);
		}

		// Can distribute less (hold funds), but not more
	}
}
```

### Decider Registry

```typescript
// src/deciders/registry.ts

type DeciderFactory = (config: DeciderConfig) => Decider;

const deciderRegistry = new Map<string, DeciderFactory>([
	['static', (config) => new StaticDecider(config.destinations!)],
	[
		'lambda',
		(config) => {
			// In production, this would load from Mjolnir
			// For now, eval the function body (DANGER: only for trusted input)
			const fn = new Function('ctx', config.functionBody!) as LambdaFn;
			return new LambdaDecider(fn, { timeout: config.timeout });
		}
	]
]);

function createDecider(type: string, config: DeciderConfig): Decider {
	const factory = deciderRegistry.get(type);
	if (!factory) throw new Error(`Unknown decider type: ${type}`);
	return factory(config);
}
```

---

## Scheduler

### Trigger Evaluation

```typescript
// src/services/scheduler-service.ts

interface SchedulerService {
	// Check all pipes for trigger conditions
	tick(): Promise<void>;

	// Force trigger a specific pipe
	triggerPipe(pipeId: string): Promise<Execution>;
}

class SchedulerServiceImpl implements SchedulerService {
	constructor(
		private pipeService: PipeService,
		private storage: Storage,
		private solanaService: SolanaService
	) {}

	async tick(): Promise<void> {
		const pipes = await this.storage.listPipes({ enabled: true });

		for (const pipe of pipes) {
			const shouldTrigger = await this.evaluateTrigger(pipe);
			if (shouldTrigger) {
				await this.pipeService.execute(pipe.id, pipe.triggerMode.type);
			}
		}
	}

	private async evaluateTrigger(pipe: Pipe): Promise<boolean> {
		switch (pipe.triggerMode.type) {
			case 'manual':
				return false; // Never auto-trigger

			case 'threshold': {
				const balance = await this.solanaService.getBalance(new PublicKey(pipe.escrowWallet));
				return balance >= BigInt(pipe.triggerMode.amountLamports);
			}

			case 'cron': {
				const lastRun = pipe.lastTriggeredAt?.getTime() ?? 0;
				const now = Date.now();
				return now - lastRun >= pipe.triggerMode.intervalMs;
			}

			case 'event':
				// Future: webhook/event listener
				return false;
		}
	}

	async triggerPipe(pipeId: string): Promise<Execution> {
		return this.pipeService.execute(pipeId, 'manual');
	}
}
```

### Tick Scheduling

For now, simple interval. Later could use bullmq for robustness.

```typescript
// In application startup

const TICK_INTERVAL_MS = 10_000; // 10 seconds

function startScheduler(scheduler: SchedulerService) {
	const tick = async () => {
		try {
			await scheduler.tick();
		} catch (err) {
			console.error('Scheduler tick failed:', err);
		}
	};

	// Initial tick
	tick();

	// Recurring
	setInterval(tick, TICK_INTERVAL_MS);
}
```

---

## Configuration

### Environment Variables

```bash
# .env.example

# ─────────────────────────────────────────────────────────────
# Required
# ─────────────────────────────────────────────────────────────

# Solana RPC endpoint
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Bags.fm API key (from dev.bags.fm)
BAGS_API_KEY=your_api_key_here

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/bagpipe

# ─────────────────────────────────────────────────────────────
# Escrow Keys (one per pipe)
# ─────────────────────────────────────────────────────────────

# Format: ESCROW_KEY_<pipeId>=<base58_private_key>
ESCROW_KEY_abc123=5abc...xyz

# ─────────────────────────────────────────────────────────────
# Optional
# ─────────────────────────────────────────────────────────────

# Solana commitment level (default: confirmed)
SOLANA_COMMITMENT=confirmed

# Scheduler tick interval in ms (default: 10000)
SCHEDULER_TICK_MS=10000

# Lambda decider timeout in ms (default: 30000)
DECIDER_TIMEOUT_MS=30000

# Log level (default: info)
LOG_LEVEL=info
```

### Config Schema

```typescript
// src/config/schema.ts

import { z } from 'zod';

const configSchema = z.object({
	solana: z.object({
		rpcUrl: z.string().url(),
		commitment: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed')
	}),

	bags: z.object({
		apiKey: z.string().min(1)
	}),

	database: z.object({
		url: z.string()
	}),

	scheduler: z.object({
		tickMs: z.number().min(1000).default(10_000),
		enabled: z.boolean().default(true)
	}),

	decider: z.object({
		timeoutMs: z.number().min(1000).default(30_000)
	}),

	logging: z.object({
		level: z.enum(['debug', 'info', 'warn', 'error']).default('info')
	})
});

type Config = z.infer<typeof configSchema>;
```

### Config Loading

```typescript
// src/config/index.ts

function loadConfig(): Config {
	const raw = {
		solana: {
			rpcUrl: process.env.SOLANA_RPC_URL,
			commitment: process.env.SOLANA_COMMITMENT
		},
		bags: {
			apiKey: process.env.BAGS_API_KEY
		},
		database: {
			url: process.env.DATABASE_URL
		},
		scheduler: {
			tickMs: process.env.SCHEDULER_TICK_MS ? parseInt(process.env.SCHEDULER_TICK_MS) : undefined,
			enabled: process.env.SCHEDULER_ENABLED !== 'false'
		},
		decider: {
			timeoutMs: process.env.DECIDER_TIMEOUT_MS
				? parseInt(process.env.DECIDER_TIMEOUT_MS)
				: undefined
		},
		logging: {
			level: process.env.LOG_LEVEL
		}
	};

	return configSchema.parse(raw);
}
```

---

## Error Handling

### Error Taxonomy

```typescript
// src/utils/errors.ts

// Base error
abstract class BagpipeError extends Error {
	abstract readonly code: string;
	abstract readonly retryable: boolean;
}

// ─────────────────────────────────────────────────────────────
// Configuration Errors (not retryable)
// ─────────────────────────────────────────────────────────────

class ConfigurationError extends BagpipeError {
	code = 'CONFIG_ERROR';
	retryable = false;
}

class WalletNotFoundError extends BagpipeError {
	code = 'WALLET_NOT_FOUND';
	retryable = false;
	constructor(pipeId: string) {
		super(`No escrow key found for pipe: ${pipeId}`);
	}
}

// ─────────────────────────────────────────────────────────────
// Solana Errors (some retryable)
// ─────────────────────────────────────────────────────────────

class SolanaRpcError extends BagpipeError {
	code = 'SOLANA_RPC_ERROR';
	retryable = true; // Transient network issues
}

class TransactionFailedError extends BagpipeError {
	code = 'TX_FAILED';
	retryable = false; // Usually means bad tx, not transient
	constructor(
		public signature: string,
		public reason: string
	) {
		super(`Transaction ${signature} failed: ${reason}`);
	}
}

class InsufficientBalanceError extends BagpipeError {
	code = 'INSUFFICIENT_BALANCE';
	retryable = false;
}

// ─────────────────────────────────────────────────────────────
// Bags Errors (mostly retryable)
// ─────────────────────────────────────────────────────────────

class BagsApiError extends BagpipeError {
	code = 'BAGS_API_ERROR';
	retryable = true;
	constructor(
		public statusCode: number,
		message: string
	) {
		super(`Bags API error (${statusCode}): ${message}`);
	}
}

class BagsRateLimitError extends BagpipeError {
	code = 'BAGS_RATE_LIMIT';
	retryable = true;
	constructor(public retryAfter?: number) {
		super('Bags API rate limit exceeded');
	}
}

// ─────────────────────────────────────────────────────────────
// Decider Errors
// ─────────────────────────────────────────────────────────────

class DeciderTimeoutError extends BagpipeError {
	code = 'DECIDER_TIMEOUT';
	retryable = true; // Might succeed on retry
	constructor(timeoutMs: number) {
		super(`Decider timed out after ${timeoutMs}ms`);
	}
}

class DeciderOverspendError extends BagpipeError {
	code = 'DECIDER_OVERSPEND';
	retryable = false; // Logic error, won't fix itself
	constructor(attempted: bigint, available: bigint) {
		super(`Decider tried to spend ${attempted} but only ${available} available`);
	}
}

class DeciderExecutionError extends BagpipeError {
	code = 'DECIDER_EXECUTION_ERROR';
	retryable = false; // User code threw
	constructor(public cause: Error) {
		super(`Decider threw: ${cause.message}`);
	}
}

// ─────────────────────────────────────────────────────────────
// Pipe Errors
// ─────────────────────────────────────────────────────────────

class PipeNotFoundError extends BagpipeError {
	code = 'PIPE_NOT_FOUND';
	retryable = false;
}

class PipeDisabledError extends BagpipeError {
	code = 'PIPE_DISABLED';
	retryable = false;
}

class RecursionDepthExceededError extends BagpipeError {
	code = 'RECURSION_DEPTH_EXCEEDED';
	retryable = false;
	constructor(depth: number, max: number) {
		super(`Pipe recursion depth ${depth} exceeds max ${max}`);
	}
}
```

### Result Type

```typescript
// src/utils/result.ts

type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
	return { ok: false, error };
}

// Usage
async function claimSafe(
	bags: BagsService,
	keypair: Keypair
): Promise<Result<ClaimResult, BagpipeError>> {
	try {
		const result = await bags.claimAll(keypair);
		return ok(result);
	} catch (e) {
		if (e instanceof BagpipeError) return err(e);
		return err(new BagsApiError(0, String(e)));
	}
}
```

### Retry Logic

```typescript
// src/utils/retry.ts

interface RetryPolicy {
	maxRetries: number;
	initialDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxRetries: 5,
	initialDelayMs: 1000,
	maxDelayMs: 60_000,
	backoffMultiplier: 2
};

async function withRetry<T>(
	fn: () => Promise<T>,
	policy: RetryPolicy = DEFAULT_RETRY_POLICY,
	isRetryable: (err: Error) => boolean = () => true
): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err as Error;

			if (!isRetryable(lastError) || attempt === policy.maxRetries) {
				throw lastError;
			}

			const delay = calculateDelay(policy, attempt);
			await sleep(delay);
		}
	}

	throw lastError;
}

function calculateDelay(policy: RetryPolicy, attempt: number): number {
	const baseDelay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt);
	const cappedDelay = Math.min(baseDelay, policy.maxDelayMs);
	// Jitter: ±20%
	const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);
	return Math.floor(cappedDelay + jitter);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
```

---

## Testing Strategy

### Test Categories

| Category        | What                       | How                       | Coverage Target |
| --------------- | -------------------------- | ------------------------- | --------------- |
| **Unit**        | Pure functions, core logic | Jest, no mocks            | 90%+            |
| **Integration** | Services with real DB      | Testcontainers (Postgres) | Key flows       |
| **E2E**         | Full system against devnet | Manual + CI               | Happy paths     |

### Unit Tests

```typescript
// tests/unit/deciders/static.test.ts

describe('StaticDecider', () => {
	it('splits correctly at 50/50', async () => {
		const decider = new StaticDecider([
			{ address: 'wallet1...', destinationType: 'wallet', shareBps: 5000 },
			{ address: 'wallet2...', destinationType: 'wallet', shareBps: 5000 }
		]);

		const ctx = makeContext({ escrowBalance: 1_000_000_000n }); // 1 SOL
		const result = await decider.decide(ctx);

		expect(result.distributions).toHaveLength(2);
		expect(result.distributions[0].amount).toBe(500_000_000n);
		expect(result.distributions[1].amount).toBe(500_000_000n);
	});

	it('gives remainder to last destination', async () => {
		const decider = new StaticDecider([
			{ address: 'a', destinationType: 'wallet', shareBps: 3333 },
			{ address: 'b', destinationType: 'wallet', shareBps: 3333 },
			{ address: 'c', destinationType: 'wallet', shareBps: 3334 }
		]);

		const ctx = makeContext({ escrowBalance: 1_000_000_001n });
		const result = await decider.decide(ctx);

		const total = result.distributions.reduce((s, d) => s + d.amount, 0n);
		expect(total).toBe(1_000_000_001n); // No dust left
	});

	it('rejects if shares != 10000', () => {
		expect(
			() => new StaticDecider([{ address: 'a', destinationType: 'wallet', shareBps: 5000 }])
		).toThrow();
	});
});
```

### Integration Tests

```typescript
// tests/integration/pipe-service.test.ts

describe('PipeService', () => {
  let db: TestDatabase;
  let service: PipeService;

  beforeAll(async () => {
    db = await TestDatabase.start(); // Testcontainers
    service = new PipeService(db.storage, mockSolana, mockBags);
  });

  afterAll(() => db.stop());

  it('creates and retrieves pipe', async () => {
    const pipe = await service.create({
      name: 'test-pipe',
      escrowWallet: 'abc123...',
      controllerType: 'wallet',
      controllerId: 'xyz...',
      decider: { type: 'static', destinations: [...] },
      triggerMode: { type: 'manual' },
    });

    const retrieved = await service.get(pipe.id);
    expect(retrieved).toMatchObject(pipe);
  });

  it('executes pipe and records execution', async () => {
    // ... setup pipe with mock balances

    const execution = await service.execute(pipe.id, 'manual');

    expect(execution.status).toBe('completed');
    expect(execution.distributions).toHaveLength(2);
  });
});
```

### Mocking Strategy

```typescript
// Mock Solana service
const mockSolana: SolanaService = {
	getBalance: jest.fn().mockResolvedValue(1_000_000_000n),
	getSplBalances: jest.fn().mockResolvedValue(new Map()),
	signAndSend: jest.fn().mockResolvedValue('mock-signature'),
	transferSol: jest.fn().mockResolvedValue('mock-signature')
};

// Mock Bags service
const mockBags: BagsService = {
	getClaimablePositions: jest.fn().mockResolvedValue([]),
	claimAll: jest
		.fn()
		.mockResolvedValue({ positionsClaimed: 0, totalLamports: 0n, txSignatures: [] })
};

// For E2E: use devnet with real SDKs, funded test wallets
```

---

## Observability

### Logging

```typescript
// src/utils/logger.ts

import pino from 'pino';

const logger = pino({
	level: process.env.LOG_LEVEL ?? 'info',
	formatters: {
		level: (label) => ({ level: label })
	}
});

// Structured log helpers
const log = {
	pipeCreated: (pipe: Pipe) =>
		logger.info({ event: 'pipe_created', pipeId: pipe.id, name: pipe.name }),

	executionStarted: (pipeId: string, trigger: string) =>
		logger.info({ event: 'execution_started', pipeId, trigger }),

	executionCompleted: (execution: Execution) =>
		logger.info({
			event: 'execution_completed',
			pipeId: execution.pipeId,
			executionId: execution.id,
			distributionCount: execution.distributions?.length,
			durationMs: execution.completedAt! - execution.triggeredAt
		}),

	executionFailed: (execution: Execution, error: Error) =>
		logger.error({
			event: 'execution_failed',
			pipeId: execution.pipeId,
			executionId: execution.id,
			error: error.message,
			retryCount: execution.retryCount
		}),

	claimCompleted: (pipeId: string, result: ClaimResult) =>
		logger.info({
			event: 'claim_completed',
			pipeId,
			positionsClaimed: result.positionsClaimed,
			totalLamports: result.totalLamports.toString()
		})
};
```

### Metrics (Future)

```typescript
// When we need it:
// - execution_count{pipe_id, status}
// - execution_duration_ms{pipe_id}
// - claim_amount_lamports{pipe_id}
// - decider_duration_ms{pipe_id, decider_type}
// - scheduler_tick_duration_ms
```

---

## Security Notes

Per design constraints, security is handled at infrastructure edges. However, document known trust boundaries:

1. **Escrow keys**: Injected via env vars. Infrastructure must protect these.
2. **Lambda deciders**: Currently `new Function()` which is eval. Only use with trusted input. Mjolnir will sandbox this properly.
3. **Bags API key**: Stored in env. Rate-limited by Bags.
4. **Database**: Standard Postgres auth. No row-level security needed (single-tenant for now).

---

## Appendix: Blake3 Usage

```typescript
// src/utils/hash.ts

import { blake3 } from '@noble/hashes/blake3';

// Hash arbitrary data
function hash(data: string | Uint8Array): Uint8Array {
	const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
	return blake3(input);
}

// Hash to hex string
function hashHex(data: string | Uint8Array): string {
	return Buffer.from(hash(data)).toString('hex');
}

// Generate pipe ID from config
function generatePipeId(config: CreatePipeInput): string {
	const canonical = JSON.stringify({
		escrowWallet: config.escrowWallet,
		controllerType: config.controllerType,
		controllerId: config.controllerId
		// Don't include mutable fields like name
	});
	return hashHex(canonical).slice(0, 16); // 16 hex chars = 64 bits
}

// Verify attestation (future Mjolnir integration)
function verifyAttestation(
	decision: DeciderResult,
	attestation: string,
	expectedHash: string
): boolean {
	const computed = hashHex(JSON.stringify(decision));
	return computed === expectedHash;
}
```

---

## Next: PLAN.md

With architecture defined, next step is creating `PLAN.md` with:

- Milestones (M1-M6)
- Task breakdown per milestone
- Dependencies
- Acceptance criteria
- Effort estimates (S/M/L)
