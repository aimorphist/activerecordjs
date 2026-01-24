import { pgTable, text, timestamp, boolean, jsonb, bigint, integer } from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// EXISTING TABLES (user/session)
// ─────────────────────────────────────────────────────────────

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	age: integer('age')
});

export const session = pgTable('session', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
});

export type Session = typeof session.$inferSelect;
export type User = typeof user.$inferSelect;

// ─────────────────────────────────────────────────────────────
// PIPES - Core routing configuration
// ─────────────────────────────────────────────────────────────

export const pipes = pgTable('pipes', {
	id: text('id').primaryKey(),
	name: text('name'),

	// Custody
	escrowWallet: text('escrow_wallet').notNull(),
	controllerType: text('controller_type').notNull(), // 'wallet' | 'multisig' | 'program' | 'mjolnir'
	controllerId: text('controller_id').notNull(),

	// Decider
	deciderType: text('decider_type').notNull().default('static'), // 'static' | 'lambda'
	deciderConfig: jsonb('decider_config').notNull().default({}),

	// Static destinations (fallback if decider fails)
	destinations: jsonb('destinations').notNull().default([]),

	// Trigger
	triggerMode: jsonb('trigger_mode').notNull().default({ type: 'manual' }),
	lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),

	// Retry
	retryPolicy: jsonb('retry_policy'),

	// State
	enabled: boolean('enabled').default(true),

	// Timestamps (ORM convention)
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

// ─────────────────────────────────────────────────────────────
// EXECUTIONS - Record of pipe executions
// ─────────────────────────────────────────────────────────────

export const executions = pgTable('executions', {
	id: text('id').primaryKey(),
	pipeId: text('pipe_id')
		.references(() => pipes.id)
		.notNull(),

	status: text('status').notNull(), // 'pending' | 'deciding' | 'executing' | 'completed' | 'failed' | 'retrying'

	// Trigger info
	triggerType: text('trigger_type').notNull(), // 'manual' | 'threshold' | 'cron'
	triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull(),

	// Pre-execution state
	balanceBefore: bigint('balance_before', { mode: 'bigint' }),
	splBalancesBefore: jsonb('spl_balances_before'), // Record<mint, amount as string>

	// Decision
	deciderResult: jsonb('decider_result'),
	deciderDurationMs: integer('decider_duration_ms'),

	// Execution result
	distributions: jsonb('distributions'),
	txSignatures: jsonb('tx_signatures'), // string[]

	completedAt: timestamp('completed_at', { withTimezone: true }),

	// Error tracking
	errorMessage: text('error_message'),
	retryCount: integer('retry_count').default(0),
	nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),

	// Timestamps
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

// ─────────────────────────────────────────────────────────────
// CLAIMS - Track Bags.fm claims
// ─────────────────────────────────────────────────────────────

export const claims = pgTable('claims', {
	id: text('id').primaryKey(),
	pipeId: text('pipe_id')
		.references(() => pipes.id)
		.notNull(),

	// Source
	tokenMint: text('token_mint').notNull(),
	positionType: text('position_type'), // 'virtual' | 'damm' | 'custom_vault'

	// Amounts
	amountLamports: bigint('amount_lamports', { mode: 'bigint' }).notNull(),

	// Transaction
	txSignature: text('tx_signature').notNull(),
	claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull(),

	// Timestamps
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

// ─────────────────────────────────────────────────────────────
// TYPE EXPORTS
// ─────────────────────────────────────────────────────────────

export type Pipe = typeof pipes.$inferSelect;
export type NewPipe = typeof pipes.$inferInsert;

export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;

export type Claim = typeof claims.$inferSelect;
export type NewClaim = typeof claims.$inferInsert;

// ─────────────────────────────────────────────────────────────
// WALLET AUTH - Authentication tables for Solana wallet auth
// ─────────────────────────────────────────────────────────────

/**
 * Wallet users table
 * Stores user accounts associated with wallet addresses
 */
export const walletUsers = pgTable('wallet_users', {
	id: text('id').primaryKey(),
	walletAddress: text('wallet_address').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

/**
 * Wallet sessions table
 * Stores active authentication sessions for wallet users
 */
export const walletSessions = pgTable('wallet_sessions', {
	id: text('id').primaryKey(),
	secretHash: text('secret_hash').notNull(),
	userId: text('user_id')
		.references(() => walletUsers.id)
		.notNull(),
	walletAddress: text('wallet_address').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

/**
 * Auth nonces table
 * Stores one-time nonces for SIWS authentication
 */
export const authNonces = pgTable('auth_nonces', {
	nonce: text('nonce').primaryKey(),
	walletAddress: text('wallet_address').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export type WalletUser = typeof walletUsers.$inferSelect;
export type NewWalletUser = typeof walletUsers.$inferInsert;

export type WalletSession = typeof walletSessions.$inferSelect;
export type NewWalletSession = typeof walletSessions.$inferInsert;

export type AuthNonce = typeof authNonces.$inferSelect;
export type NewAuthNonce = typeof authNonces.$inferInsert;
