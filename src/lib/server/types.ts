// ─────────────────────────────────────────────────────────────
// Controller Types
// ─────────────────────────────────────────────────────────────

export type ControllerType = 'wallet' | 'multisig' | 'program' | 'mjolnir';

// ─────────────────────────────────────────────────────────────
// Trigger Modes
// ─────────────────────────────────────────────────────────────

export type TriggerMode =
	| { type: 'manual' }
	| { type: 'threshold'; amountLamports: string } // string for JSON serialization
	| { type: 'cron'; intervalMs: number }
	| { type: 'event'; eventType: string };

// ─────────────────────────────────────────────────────────────
// Destinations
// ─────────────────────────────────────────────────────────────

export type DestinationType = 'wallet' | 'program' | 'pipe';

export interface Destination {
	address: string; // base58 pubkey
	destinationType: DestinationType;
	shareBps: number; // basis points, 10000 = 100%
	minAmount?: string; // bigint as string
}

// ─────────────────────────────────────────────────────────────
// Decider
// ─────────────────────────────────────────────────────────────

export type DeciderType = 'static' | 'lambda';

export interface DeciderConfig {
	functionId?: string;
	functionBody?: string;
	timeout?: number;
	staticDestinations?: Destination[];
}

// ─────────────────────────────────────────────────────────────
// Distributions
// ─────────────────────────────────────────────────────────────

export interface Distribution {
	destination: string; // base58 pubkey
	amount: string; // bigint as string
	mint?: string; // base58 pubkey, undefined = SOL
}

export interface DeciderResult {
	distributions: Distribution[];
	metadata?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Retry Policy
// ─────────────────────────────────────────────────────────────

export interface RetryPolicy {
	maxRetries: number;
	initialDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
}

// ─────────────────────────────────────────────────────────────
// Execution Status
// ─────────────────────────────────────────────────────────────

export type ExecutionStatus =
	| 'pending'
	| 'deciding'
	| 'executing'
	| 'completed'
	| 'failed'
	| 'retrying';

// ─────────────────────────────────────────────────────────────
// Claim Types
// ─────────────────────────────────────────────────────────────

export type PositionType = 'virtual' | 'damm' | 'custom_vault';

// ─────────────────────────────────────────────────────────────
// Bags.fm Types
// ─────────────────────────────────────────────────────────────

export interface ClaimablePosition {
	baseMint: string;
	virtualPoolClaimableAmount: number;
	dammPoolClaimableAmount: number;
	totalClaimableLamportsUserShare: number;
	isMigrated: boolean;
	positionType: PositionType;
}

export interface ClaimResult {
	claimed: number;
	totalLamports: bigint;
	transactions: string[];
	claims: Array<{
		tokenMint: string;
		amountLamports: bigint;
		txSignature: string;
		positionType: PositionType;
	}>;
}
