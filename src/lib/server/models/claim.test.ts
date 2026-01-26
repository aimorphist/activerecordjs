import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CreateClaimInput } from './claim';

// Mock the database
vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue([]),
		insert: vi.fn().mockReturnThis(),
		values: vi.fn().mockReturnThis(),
		returning: vi.fn().mockResolvedValue([
			{
				id: 'claim_abc123',
				pipeId: 'pipe_test',
				tokenMint: 'TokenMint111111111111111111111111111111111',
				positionType: 'virtual',
				amountLamports: 1000000n,
				txSignature: 'sig123',
				claimedAt: new Date(),
				createdAt: new Date(),
				updatedAt: new Date()
			}
		]),
		update: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis()
	}
}));

describe('ClaimModel', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('create', () => {
		it('should create a claim with all required fields', async () => {
			const { ClaimModel } = await import('./claim');

			const input: CreateClaimInput = {
				pipeId: 'pipe_test',
				tokenMint: 'TokenMint111111111111111111111111111111111',
				positionType: 'virtual',
				amountLamports: 1000000n,
				txSignature: 'sig123'
			};

			const claim = await ClaimModel.create(input);

			expect(claim).toBeDefined();
			expect(claim.id).toContain('claim_');
			expect(claim.pipeId).toBe('pipe_test');
			expect(claim.tokenMint).toBe('TokenMint111111111111111111111111111111111');
		});

		it('should generate unique IDs based on input data', async () => {
			const { generateId } = await import('$lib/server/utils/hash');

			const id1 = generateId('claim', {
				pipeId: 'pipe_a',
				tokenMint: 'token_1',
				txSignature: 'sig_1'
			});

			const id2 = generateId('claim', {
				pipeId: 'pipe_a',
				tokenMint: 'token_1',
				txSignature: 'sig_2'
			});

			expect(id1).not.toBe(id2);
			expect(id1).toContain('claim_');
			expect(id2).toContain('claim_');
		});

		it('should handle null positionType', async () => {
			const { ClaimModel } = await import('./claim');

			const input: CreateClaimInput = {
				pipeId: 'pipe_test',
				tokenMint: 'TokenMint111111111111111111111111111111111',
				amountLamports: 1000000n,
				txSignature: 'sig123'
			};

			const claim = await ClaimModel.create(input);

			expect(claim).toBeDefined();
		});
	});

	describe('query helpers', () => {
		it('forPipe should filter by pipeId', async () => {
			const { ClaimModel } = await import('./claim');
			const { db } = await import('$lib/server/db');

			await ClaimModel.forPipe('pipe_test');

			expect(db.select).toHaveBeenCalled();
		});

		it('forToken should filter by tokenMint', async () => {
			const { ClaimModel } = await import('./claim');
			const { db } = await import('$lib/server/db');

			await ClaimModel.forToken('TokenMint111111111111111111111111111111111');

			expect(db.select).toHaveBeenCalled();
		});

		it('forPipeAndToken should filter by both', async () => {
			const { ClaimModel } = await import('./claim');
			const { db } = await import('$lib/server/db');

			await ClaimModel.forPipeAndToken('pipe_test', 'TokenMint111111111111111111111111111111111');

			expect(db.select).toHaveBeenCalled();
		});
	});
});
