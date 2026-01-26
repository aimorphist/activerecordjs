import { describe, it, expect } from 'vitest';
import {
	BagpipeError,
	ConfigurationError,
	SolanaRpcError,
	WalletNotFoundError,
	PipeNotFoundError,
	BagsApiError,
	NoClaimablePositionsError,
	ClaimFailedError
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

	// Bags.fm Errors
	describe('Bags.fm Errors', () => {
		it('BagsApiError is retryable', () => {
			const error = new BagsApiError('API request failed');

			expect(error.message).toBe('API request failed');
			expect(error.code).toBe('BAGS_API_ERROR');
			expect(error.retryable).toBe(true);
		});

		it('NoClaimablePositionsError formats wallet correctly', () => {
			const error = new NoClaimablePositionsError('WalletAddress123');

			expect(error.message).toBe('No claimable positions for wallet: WalletAddress123');
			expect(error.code).toBe('NO_CLAIMABLE_POSITIONS');
			expect(error.retryable).toBe(false);
		});

		it('ClaimFailedError includes tokenMint', () => {
			const error = new ClaimFailedError('TokenMint123', 'Transaction timeout');

			expect(error.message).toBe('Failed to claim for token TokenMint123: Transaction timeout');
			expect(error.code).toBe('CLAIM_FAILED');
			expect(error.tokenMint).toBe('TokenMint123');
			expect(error.retryable).toBe(true);
		});
	});
});
