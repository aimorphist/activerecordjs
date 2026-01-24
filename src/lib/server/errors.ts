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
