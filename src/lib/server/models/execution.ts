import { executions, type Execution, type NewExecution } from '$lib/server/db/schema';
import { createModelHelpers } from './base';
import { generateId } from '$lib/server/utils/hash';
import type { DeciderResult, Distribution } from '$lib/server/types';

const helpers = createModelHelpers<typeof executions, Execution, NewExecution>(executions);

export interface CreateExecutionInput {
	pipeId: string;
	triggerType: 'manual' | 'threshold' | 'cron';
	balanceBefore?: bigint;
	splBalancesBefore?: Record<string, string>;
}

export const ExecutionModel = {
	async find(id: string): Promise<Execution> {
		return helpers.find(id);
	},

	async all(): Promise<Execution[]> {
		return helpers.all();
	},

	async where(attrs: Partial<Execution>): Promise<Execution[]> {
		return helpers.where(attrs);
	},

	async create(input: CreateExecutionInput): Promise<Execution> {
		const id = generateId('exec', {
			pipeId: input.pipeId,
			timestamp: Date.now()
		});

		return helpers.create({
			id,
			pipeId: input.pipeId,
			status: 'pending',
			triggerType: input.triggerType,
			triggeredAt: new Date(),
			balanceBefore: input.balanceBefore ?? null,
			splBalancesBefore: input.splBalancesBefore ?? null
		});
	},

	async update(id: string, attrs: Partial<NewExecution>): Promise<Execution> {
		return helpers.update(id, attrs);
	},

	// Status transitions

	async markDeciding(id: string): Promise<Execution> {
		return helpers.update(id, { status: 'deciding' });
	},

	async markExecuting(id: string, result: DeciderResult, durationMs: number): Promise<Execution> {
		return helpers.update(id, {
			status: 'executing',
			deciderResult: result,
			deciderDurationMs: durationMs
		});
	},

	async markCompleted(
		id: string,
		distributions: Distribution[],
		txSignatures: string[]
	): Promise<Execution> {
		return helpers.update(id, {
			status: 'completed',
			distributions,
			txSignatures,
			completedAt: new Date()
		});
	},

	async markFailed(id: string, errorMessage: string): Promise<Execution> {
		const execution = await helpers.find(id);
		const retryCount = (execution.retryCount ?? 0) + 1;

		return helpers.update(id, {
			status: 'failed',
			errorMessage,
			retryCount
		});
	},

	async markRetrying(id: string, nextRetryAt: Date): Promise<Execution> {
		return helpers.update(id, {
			status: 'retrying',
			nextRetryAt
		});
	},

	// Queries

	async forPipe(pipeId: string): Promise<Execution[]> {
		return helpers.where({ pipeId } as Partial<Execution>);
	},

	async pendingRetries(): Promise<Execution[]> {
		// Note: This needs a more complex query; simplified for now
		return helpers.where({ status: 'retrying' } as Partial<Execution>);
	}
};
