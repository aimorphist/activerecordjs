import type { Config } from '$lib/server/config';
import { loadConfig } from '$lib/server/config';
import { PipeService } from '$lib/server/services/pipe-service';
import { PipeModel, type CreatePipeInput } from '$lib/server/models/pipe';
import { ExecutionModel } from '$lib/server/models/execution';

export interface Bagpipe {
	pipes: typeof PipeModel;
	executions: typeof ExecutionModel;
	trigger: (pipeId: string) => Promise<string>;
}

export function createBagpipe(config?: Partial<Config>): Bagpipe {
	const fullConfig = config ? { ...loadConfig(), ...config } : loadConfig();
	const pipeService = new PipeService(fullConfig);

	return {
		pipes: PipeModel,
		executions: ExecutionModel,
		trigger: (pipeId: string) => pipeService.trigger(pipeId)
	};
}

// Re-export types
export type { CreatePipeInput } from '$lib/server/models/pipe';
export type { Destination, Distribution, DeciderResult } from '$lib/server/types';
