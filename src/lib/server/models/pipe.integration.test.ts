import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PipeModel, type CreatePipeInput } from './pipe';
import { DestinationValidationError } from '$lib/server/utils/validation';
import { PipeNotFoundError } from '$lib/server/errors';
import { db } from '$lib/server/db';
import { pipes } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

describe('PipeModel Integration Tests', () => {
	const testPipeIds: string[] = [];

	const validInput: CreatePipeInput = {
		name: 'test-pipe',
		escrowWallet: 'EscrowWallet111111111111111111111111111111111',
		controllerType: 'wallet',
		controllerId: 'Controller11111111111111111111111111111111111',
		deciderType: 'static',
		destinations: [
			{ address: 'Dest111111111111111111111111111111111111111', destinationType: 'wallet', shareBps: 5000 },
			{ address: 'Dest222222222222222222222222222222222222222', destinationType: 'wallet', shareBps: 5000 }
		],
		triggerMode: { type: 'manual' }
	};

	afterEach(async () => {
		// Clean up test pipes
		for (const id of testPipeIds) {
			try {
				await db.delete(pipes).where(eq(pipes.id, id));
			} catch {
				// ignore if already deleted
			}
		}
		testPipeIds.length = 0;
	});

	describe('create()', () => {
		it('creates a pipe with valid destinations', async () => {
			const pipe = await PipeModel.create(validInput);
			testPipeIds.push(pipe.id);

			expect(pipe.id).toMatch(/^pipe_[a-f0-9]{12}$/);
			expect(pipe.name).toBe('test-pipe');
			expect(pipe.escrowWallet).toBe(validInput.escrowWallet);
			expect(pipe.controllerType).toBe('wallet');
			expect(pipe.deciderType).toBe('static');
			expect(pipe.enabled).toBe(true);
		});

		it('creates pipe with no destinations (empty array is allowed)', async () => {
			const input = { ...validInput, destinations: [] };
			const pipe = await PipeModel.create(input);
			testPipeIds.push(pipe.id);

			expect(pipe.id).toBeDefined();
		});

		it('throws DestinationValidationError for invalid destination sum', async () => {
			const input = {
				...validInput,
				destinations: [
					{ address: 'Dest1', destinationType: 'wallet' as const, shareBps: 5000 }
				]
			};

			await expect(PipeModel.create(input)).rejects.toThrow(DestinationValidationError);
		});

		it('throws for negative share', async () => {
			const input = {
				...validInput,
				destinations: [
					{ address: 'Dest1', destinationType: 'wallet' as const, shareBps: -1000 },
					{ address: 'Dest2', destinationType: 'wallet' as const, shareBps: 11000 }
				]
			};

			await expect(PipeModel.create(input)).rejects.toThrow('share must be positive');
		});
	});

	describe('find()', () => {
		it('finds existing pipe by id', async () => {
			const created = await PipeModel.create(validInput);
			testPipeIds.push(created.id);

			const found = await PipeModel.find(created.id);

			expect(found.id).toBe(created.id);
			expect(found.name).toBe(created.name);
		});

		it('throws PipeNotFoundError for missing id', async () => {
			await expect(PipeModel.find('nonexistent_id')).rejects.toThrow(PipeNotFoundError);
		});
	});

	describe('update()', () => {
		it('updates pipe attributes', async () => {
			const created = await PipeModel.create(validInput);
			testPipeIds.push(created.id);

			const updated = await PipeModel.update(created.id, { name: 'updated-name' });

			expect(updated.name).toBe('updated-name');
		});
	});

	describe('destroy()', () => {
		it('removes pipe from database', async () => {
			const created = await PipeModel.create(validInput);
			// Don't add to testPipeIds since we're deleting it

			await PipeModel.destroy(created.id);

			await expect(PipeModel.find(created.id)).rejects.toThrow(PipeNotFoundError);
		});
	});

	describe('listEnabled()', () => {
		it('returns only enabled pipes', async () => {
			const enabled = await PipeModel.create({ ...validInput, enabled: true });
			testPipeIds.push(enabled.id);

			// Create a unique input for the disabled pipe
			const disabledInput = {
				...validInput,
				escrowWallet: 'DisabledEscrow11111111111111111111111111111',
				enabled: false
			};
			const disabled = await PipeModel.create(disabledInput);
			testPipeIds.push(disabled.id);

			const list = await PipeModel.listEnabled();
			const ids = list.map(p => p.id);

			expect(ids).toContain(enabled.id);
			expect(ids).not.toContain(disabled.id);
		});
	});
});
