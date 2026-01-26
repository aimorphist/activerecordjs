export class BagpipeError extends Error {
	readonly code: string;
	readonly retryable: boolean;

	constructor(message: string, code: string, retryable = false) {
		super(message);
		this.name = 'BagpipeError';
		this.code = code;
		this.retryable = retryable;
	}
}

export class ConfigurationError extends BagpipeError {
	constructor(message: string) {
		super(message, 'CONFIG_ERROR', false);
		this.name = 'ConfigurationError';
	}
}

export class SolanaRpcError extends BagpipeError {
	constructor(message: string) {
		super(message, 'SOLANA_RPC_ERROR', true);
		this.name = 'SolanaRpcError';
	}
}

export class WalletNotFoundError extends BagpipeError {
	constructor(pipeId: string) {
		super(`No escrow key found for pipe: ${pipeId}`, 'WALLET_NOT_FOUND', false);
		this.name = 'WalletNotFoundError';
	}
}

export class PipeNotFoundError extends BagpipeError {
	constructor(id: string) {
		super(`Pipe not found: ${id}`, 'PIPE_NOT_FOUND', false);
		this.name = 'PipeNotFoundError';
	}
}

export class TransactionFailedError extends BagpipeError {
	readonly signature: string;

	constructor(signature: string, reason: string) {
		super(`Transaction ${signature} failed: ${reason}`, 'TX_FAILED', false);
		this.name = 'TransactionFailedError';
		this.signature = signature;
	}
}

export class InsufficientBalanceError extends BagpipeError {
	constructor(required: bigint, available: bigint) {
		super(
			`Insufficient balance: need ${required}, have ${available}`,
			'INSUFFICIENT_BALANCE',
			false
		);
		this.name = 'InsufficientBalanceError';
	}
}

export class ExecutionError extends BagpipeError {
	constructor(executionId: string, message: string) {
		super(`Execution ${executionId} failed: ${message}`, 'EXECUTION_ERROR', false);
		this.name = 'ExecutionError';
	}
}

export class PipeDisabledError extends BagpipeError {
	constructor(pipeId: string) {
		super(`Pipe ${pipeId} is disabled`, 'PIPE_DISABLED', false);
		this.name = 'PipeDisabledError';
	}
}

// ─────────────────────────────────────────────────────────────
// Bags.fm Errors
// ─────────────────────────────────────────────────────────────

export class BagsApiError extends BagpipeError {
	constructor(message: string) {
		super(message, 'BAGS_API_ERROR', true);
		this.name = 'BagsApiError';
	}
}

export class NoClaimablePositionsError extends BagpipeError {
	constructor(wallet: string) {
		super(`No claimable positions for wallet: ${wallet}`, 'NO_CLAIMABLE_POSITIONS', false);
		this.name = 'NoClaimablePositionsError';
	}
}

export class ClaimFailedError extends BagpipeError {
	readonly tokenMint: string;

	constructor(tokenMint: string, reason: string) {
		super(`Failed to claim for token ${tokenMint}: ${reason}`, 'CLAIM_FAILED', true);
		this.name = 'ClaimFailedError';
		this.tokenMint = tokenMint;
	}
}
