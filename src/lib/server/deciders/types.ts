import type { DeciderResult } from '$lib/server/types';

export interface DeciderContext {
	pipeId: string;
	escrowWallet: string;
	escrowBalance: bigint;
	splBalances: Map<string, bigint>;
	trigger: {
		type: 'manual' | 'threshold' | 'cron';
		timestamp: number;
	};
}

export interface Decider {
	readonly type: 'static' | 'lambda';
	decide(ctx: DeciderContext): Promise<DeciderResult>;
}
