import { claims, type Claim, type NewClaim } from '$lib/server/db/schema';
import { createModelHelpers } from './base';
import { generateId } from '$lib/server/utils/hash';
import type { PositionType } from '$lib/server/types';

const helpers = createModelHelpers<typeof claims, Claim, NewClaim>(claims);

export interface CreateClaimInput {
	pipeId: string;
	tokenMint: string;
	positionType?: PositionType;
	amountLamports: bigint;
	txSignature: string;
}

export const ClaimModel = {
	async find(id: string): Promise<Claim> {
		return helpers.find(id);
	},

	async all(): Promise<Claim[]> {
		return helpers.all();
	},

	async where(attrs: Partial<Claim>): Promise<Claim[]> {
		return helpers.where(attrs);
	},

	async create(input: CreateClaimInput): Promise<Claim> {
		const id = generateId('claim', {
			pipeId: input.pipeId,
			tokenMint: input.tokenMint,
			txSignature: input.txSignature
		});

		return helpers.create({
			id,
			pipeId: input.pipeId,
			tokenMint: input.tokenMint,
			positionType: input.positionType ?? null,
			amountLamports: input.amountLamports,
			txSignature: input.txSignature,
			claimedAt: new Date()
		});
	},

	// Query helpers

	async forPipe(pipeId: string): Promise<Claim[]> {
		return helpers.where({ pipeId } as Partial<Claim>);
	},

	async forToken(tokenMint: string): Promise<Claim[]> {
		return helpers.where({ tokenMint } as Partial<Claim>);
	},

	async forPipeAndToken(pipeId: string, tokenMint: string): Promise<Claim[]> {
		return helpers.where({ pipeId, tokenMint } as Partial<Claim>);
	}
};
