import { describe, it, expect } from 'vitest';
import {
	BagpipeError,
	ConfigurationError,
	SolanaRpcError,
	WalletNotFoundError,
	PipeNotFoundError
} from './errors';

describe('Errors', () => {
	it('BagpipeError has correct properties', () => {
		const error = new BagpipeError('test', 'TEST_CODE', true);

		expect(error.message).toBe('test');
		expect(error.code).toBe('TEST_CODE');
		expect(error.retryable).toBe(true);
		expect(error).toBeInstanceOf(Error);
	});

	it('ConfigurationError is not retryable', () => {
		const error = new ConfigurationError('bad config');

		expect(error.code).toBe('CONFIG_ERROR');
		expect(error.retryable).toBe(false);
	});

	it('SolanaRpcError is retryable', () => {
		const error = new SolanaRpcError('rpc failed');

		expect(error.code).toBe('SOLANA_RPC_ERROR');
		expect(error.retryable).toBe(true);
	});

	it('WalletNotFoundError formats message correctly', () => {
		const error = new WalletNotFoundError('pipe_abc123');

		expect(error.message).toBe('No escrow key found for pipe: pipe_abc123');
		expect(error.code).toBe('WALLET_NOT_FOUND');
	});

	it('PipeNotFoundError formats message correctly', () => {
		const error = new PipeNotFoundError('pipe_xyz');

		expect(error.message).toBe('Pipe not found: pipe_xyz');
		expect(error.code).toBe('PIPE_NOT_FOUND');
	});
});
