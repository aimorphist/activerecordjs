import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import { NoClaimablePositionsError, BagsApiError } from '$lib/server/errors';

// Mock functions that will be used by the SDK
const mockGetAllClaimablePositions = vi.fn();
const mockGetClaimTransaction = vi.fn();

// Mock the Bags SDK with a proper class
vi.mock('@bagsfm/bags-sdk', () => ({
	BagsSDK: class MockBagsSDK {
		fee = {
			getAllClaimablePositions: mockGetAllClaimablePositions,
			getClaimTransaction: mockGetClaimTransaction
		};
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		constructor(_apiKey: string, _connection: unknown, _commitment?: string) {}
	}
}));

// Mock the ClaimModel
vi.mock('$lib/server/models/claim', () => ({
	ClaimModel: {
		create: vi.fn().mockResolvedValue({ id: 'test-claim-id' })
	}
}));

// Mock withRetry to execute function directly without retries (for faster tests)
vi.mock('$lib/server/utils/retry', () => ({
	withRetry: vi.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
	DEFAULT_RETRY_POLICY: {
		maxRetries: 0,
		initialDelayMs: 0,
		maxDelayMs: 0,
		backoffMultiplier: 1
	}
}));

describe('BagsService', () => {
	const mockConfig = {
		solana: {
			rpcUrl: 'https://api.devnet.solana.com',
			commitment: 'processed'
		},
		bags: {
			apiKey: 'test-api-key',
			apiUrl: 'https://public-api-v2.bags.fm'
		},
		scheduler: {
			tickMs: 10000,
			enabled: true
		},
		decider: {
			timeoutMs: 30000
		}
	} as const;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('getClaimablePositions', () => {
		it('should return empty array when no positions', async () => {
			mockGetAllClaimablePositions.mockResolvedValue([]);

			const { BagsService } = await import('./bags');
			const service = new BagsService(mockConfig);
			const wallet = new PublicKey('11111111111111111111111111111111');
			const positions = await service.getClaimablePositions(wallet);

			expect(positions).toEqual([]);
		});

		it('should classify virtual positions correctly', async () => {
			const mockPosition = {
				baseMint: 'TokenMint111111111111111111111111111111111',
				virtualPoolClaimableAmount: 1000000,
				dammPoolClaimableAmount: 0,
				totalClaimableLamportsUserShare: 1000000,
				isMigrated: false,
				isCustomFeeVault: false
			};

			mockGetAllClaimablePositions.mockResolvedValue([mockPosition]);

			const { BagsService } = await import('./bags');
			const service = new BagsService(mockConfig);
			const wallet = new PublicKey('11111111111111111111111111111111');
			const positions = await service.getClaimablePositions(wallet);

			expect(positions).toHaveLength(1);
			expect(positions[0].positionType).toBe('virtual');
			expect(positions[0].virtualPoolClaimableAmount).toBe(1000000);
		});

		it('should classify damm positions correctly', async () => {
			const mockPosition = {
				baseMint: 'TokenMint111111111111111111111111111111111',
				virtualPoolClaimableAmount: 0,
				dammPoolClaimableAmount: 2000000,
				totalClaimableLamportsUserShare: 2000000,
				isMigrated: true,
				isCustomFeeVault: false
			};

			mockGetAllClaimablePositions.mockResolvedValue([mockPosition]);

			const { BagsService } = await import('./bags');
			const service = new BagsService(mockConfig);
			const wallet = new PublicKey('11111111111111111111111111111111');
			const positions = await service.getClaimablePositions(wallet);

			expect(positions).toHaveLength(1);
			expect(positions[0].positionType).toBe('damm');
			expect(positions[0].dammPoolClaimableAmount).toBe(2000000);
		});

		it('should classify custom_vault positions correctly', async () => {
			const mockPosition = {
				baseMint: 'TokenMint111111111111111111111111111111111',
				virtualPoolClaimableLamportsUserShare: 500000,
				totalClaimableLamportsUserShare: 500000,
				isMigrated: false,
				isCustomFeeVault: true,
				customFeeVaultBalance: 500000
			};

			mockGetAllClaimablePositions.mockResolvedValue([mockPosition]);

			const { BagsService } = await import('./bags');
			const service = new BagsService(mockConfig);
			const wallet = new PublicKey('11111111111111111111111111111111');
			const positions = await service.getClaimablePositions(wallet);

			expect(positions).toHaveLength(1);
			expect(positions[0].positionType).toBe('custom_vault');
		});

		it('should throw BagsApiError when SDK fails', async () => {
			mockGetAllClaimablePositions.mockRejectedValue(new Error('API timeout'));

			const { BagsService } = await import('./bags');
			const service = new BagsService(mockConfig);
			const wallet = new PublicKey('11111111111111111111111111111111');

			await expect(service.getClaimablePositions(wallet)).rejects.toThrow(BagsApiError);
		});
	});

	describe('claimAll', () => {
		it('should throw NoClaimablePositionsError when no positions', async () => {
			mockGetAllClaimablePositions.mockResolvedValue([]);

			const { BagsService } = await import('./bags');
			const service = new BagsService(mockConfig);
			const escrowKeypair = Keypair.generate();

			await expect(service.claimAll(escrowKeypair, 'pipe_test123')).rejects.toThrow(
				NoClaimablePositionsError
			);
		});
	});

	describe('claimForToken', () => {
		it('should throw NoClaimablePositionsError when token not found', async () => {
			const mockPosition = {
				baseMint: 'DifferentToken1111111111111111111111111111',
				virtualPoolClaimableAmount: 1000000,
				totalClaimableLamportsUserShare: 1000000,
				isMigrated: false,
				isCustomFeeVault: false
			};

			mockGetAllClaimablePositions.mockResolvedValue([mockPosition]);

			const { BagsService } = await import('./bags');
			const service = new BagsService(mockConfig);
			const escrowKeypair = Keypair.generate();

			await expect(
				service.claimForToken(
					escrowKeypair,
					'pipe_test123',
					'TargetToken111111111111111111111111111111'
				)
			).rejects.toThrow(NoClaimablePositionsError);
		});
	});
});
