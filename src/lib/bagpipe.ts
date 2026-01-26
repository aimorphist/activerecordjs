import type { Config } from '$lib/server/config';
import { loadConfig } from '$lib/server/config';
import { PipeService } from '$lib/server/services/pipe-service';
import { BagsService } from '$lib/server/services/bags';
import { PipeModel, type CreatePipeInput } from '$lib/server/models/pipe';
import { ExecutionModel } from '$lib/server/models/execution';
import { ClaimModel } from '$lib/server/models/claim';
import { EnvWalletService } from '$lib/server/services/wallet';
import type { ClaimResult } from '$lib/server/types';

export interface Bagpipe {
	pipes: typeof PipeModel;
	executions: typeof ExecutionModel;
	claims: typeof ClaimModel;
	trigger: (pipeId: string) => Promise<string>;
	claimAll: (pipeId: string) => Promise<ClaimResult>;
	claimForToken: (pipeId: string, tokenMint: string) => Promise<ClaimResult>;
	claimAndExecute: (pipeId: string) => Promise<{ claimResult: ClaimResult; executionId: string }>;
}

export function createBagpipe(config?: Partial<Config>): Bagpipe {
	const fullConfig = config ? { ...loadConfig(), ...config } : loadConfig();
	const pipeService = new PipeService(fullConfig);
	const bagsService = new BagsService(fullConfig);
	const walletService = new EnvWalletService();

	return {
		pipes: PipeModel,
		executions: ExecutionModel,
		claims: ClaimModel,

		trigger: (pipeId: string) => pipeService.trigger(pipeId),

		claimAll: async (pipeId: string): Promise<ClaimResult> => {
			const escrowKeypair = await walletService.getEscrowKeypair(pipeId);
			return bagsService.claimAll(escrowKeypair, pipeId);
		},

		claimForToken: async (pipeId: string, tokenMint: string): Promise<ClaimResult> => {
			const escrowKeypair = await walletService.getEscrowKeypair(pipeId);
			return bagsService.claimForToken(escrowKeypair, pipeId, tokenMint);
		},

		claimAndExecute: async (pipeId: string) => {
			const escrowKeypair = await walletService.getEscrowKeypair(pipeId);
			const claimResult = await bagsService.claimAll(escrowKeypair, pipeId);
			const executionId = await pipeService.trigger(pipeId);
			return { claimResult, executionId };
		}
	};
}

// Re-export types
export type { CreatePipeInput } from '$lib/server/models/pipe';
export type { Destination, Distribution, DeciderResult, ClaimResult } from '$lib/server/types';
