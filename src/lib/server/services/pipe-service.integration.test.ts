import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PipeService } from './pipe-service';
import { PipeModel, type CreatePipeInput } from '$lib/server/models/pipe';
import { ExecutionModel } from '$lib/server/models/execution';
import { PipeDisabledError, ExecutionError } from '$lib/server/errors';
import { db } from '$lib/server/db';
import { pipes, executions } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { Config } from '$lib/server/config';

// Mock config
const mockConfig: Config = {
	solana: {
		rpcUrl: 'https://api.devnet.solana.com',
		commitment: 'confirmed'
	},
	bags: {
		apiKey: 'test-key',
		apiUrl: 'https://public-api-v2.bags.fm'
	},
	scheduler: {
		tickMs: 10000,
		enabled: false
	},
	decider: {
		timeoutMs: 30000
	}
};

describe('PipeService Integration Tests', () => {
	const testPipeIds: string[] = [];
	const testExecutionIds: string[] = [];

	const validInput: CreatePipeInput = {
		name: 'service-test-pipe',
		escrowWallet: 'ServiceTestEscrow11111111111111111111111111',
		controllerType: 'wallet',
		controllerId: 'ServiceTestController1111111111111111111111',
		deciderType: 'static',
		destinations: [
			{ address: 'Dest111111111111111111111111111111111111111', destinationType: 'wallet', shareBps: 6000 },
			{ address: 'Dest222222222222222222222222222222222222222', destinationType: 'wallet', shareBps: 4000 }
		],
		triggerMode: { type: 'manual' }
	};

	afterEach(async () => {
		// Clean up executions first (foreign key)
		for (const id of testExecutionIds) {
			try {
				await db.delete(executions).where(eq(executions.id, id));
			} catch {
				// ignore
			}
		}
		testExecutionIds.length = 0;

		// Clean up pipes
		for (const id of testPipeIds) {
			try {
				await db.delete(pipes).where(eq(pipes.id, id));
			} catch {
				// ignore
			}
		}
		testPipeIds.length = 0;

		vi.restoreAllMocks();
	});

	describe('trigger()', () => {
		it('throws PipeDisabledError for disabled pipe', async () => {
			const pipe = await PipeModel.create({ ...validInput, enabled: false });
			testPipeIds.push(pipe.id);

			const service = new PipeService(mockConfig);

			await expect(service.trigger(pipe.id)).rejects.toThrow(PipeDisabledError);
		});

		it('creates execution record on trigger attempt', async () => {
			const pipe = await PipeModel.create(validInput);
			testPipeIds.push(pipe.id);

			const service = new PipeService(mockConfig);

			// This will fail bc no escrow key set, but should still create execution
			try {
				await service.trigger(pipe.id);
			} catch (e) {
				// Expected to fail
				if (e instanceof ExecutionError) {
					// Extract execution ID from error message
					const match = e.message.match(/Execution (exec_[a-f0-9]+)/);
					if (match) {
						testExecutionIds.push(match[1]);
					}
				}
			}

			// Check that an execution was created for this pipe
			const pipeExecutions = await ExecutionModel.forPipe(pipe.id);
			expect(pipeExecutions.length).toBeGreaterThan(0);

			// Clean up the execution
			for (const exec of pipeExecutions) {
				testExecutionIds.push(exec.id);
			}
		});

		it('execution has correct initial state', async () => {
			const pipe = await PipeModel.create(validInput);
			testPipeIds.push(pipe.id);

			const service = new PipeService(mockConfig);

			try {
				await service.trigger(pipe.id);
			} catch {
				// Expected
			}

			const pipeExecutions = await ExecutionModel.forPipe(pipe.id);
			const exec = pipeExecutions[0];
			testExecutionIds.push(exec.id);

			expect(exec.pipeId).toBe(pipe.id);
			expect(exec.triggerType).toBe('manual');
			// Status should be 'failed' bc no escrow key
			expect(exec.status).toBe('failed');
		});
	});
});
