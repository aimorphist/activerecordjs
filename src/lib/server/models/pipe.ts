import { pipes, type Pipe, type NewPipe } from '$lib/server/db/schema';
import { createModelHelpers } from './base';
import { generateId } from '$lib/server/utils/hash';
import { PipeNotFoundError } from '$lib/server/errors';
import { validateDestinations } from '$lib/server/utils/validation';
import type { Destination, TriggerMode, DeciderConfig, RetryPolicy } from '$lib/server/types';

const helpers = createModelHelpers<typeof pipes, Pipe, NewPipe>(pipes);

export interface CreatePipeInput {
	name?: string;
	escrowWallet: string;
	controllerType: 'wallet' | 'multisig' | 'program' | 'mjolnir';
	controllerId: string;
	deciderType?: 'static' | 'lambda';
	deciderConfig?: DeciderConfig;
	destinations?: Destination[];
	triggerMode?: TriggerMode;
	retryPolicy?: RetryPolicy;
	enabled?: boolean;
}

export const PipeModel = {
	async find(id: string): Promise<Pipe> {
		try {
			return await helpers.find(id);
		} catch {
			throw new PipeNotFoundError(id);
		}
	},

	async findBy(attrs: Partial<Pipe>): Promise<Pipe | null> {
		return helpers.findBy(attrs);
	},

	async all(): Promise<Pipe[]> {
		return helpers.all();
	},

	async where(attrs: Partial<Pipe>): Promise<Pipe[]> {
		return helpers.where(attrs);
	},

	async create(input: CreatePipeInput): Promise<Pipe> {
		// Validate destinations if provided
		if (input.destinations && input.destinations.length > 0) {
			validateDestinations(input.destinations);
		}

		const id = generateId('pipe', {
			escrowWallet: input.escrowWallet,
			controllerType: input.controllerType,
			controllerId: input.controllerId
		});

		return helpers.create({
			id,
			name: input.name ?? null,
			escrowWallet: input.escrowWallet,
			controllerType: input.controllerType,
			controllerId: input.controllerId,
			deciderType: input.deciderType ?? 'static',
			deciderConfig: input.deciderConfig ?? {},
			destinations: input.destinations ?? [],
			triggerMode: input.triggerMode ?? { type: 'manual' },
			retryPolicy: input.retryPolicy ?? null,
			enabled: input.enabled ?? true
		});
	},

	async update(id: string, attrs: Partial<CreatePipeInput>): Promise<Pipe> {
		return helpers.update(id, attrs as Partial<NewPipe>);
	},

	async destroy(id: string): Promise<void> {
		return helpers.destroy(id);
	},

	// Domain-specific methods

	async findByEscrowWallet(wallet: string): Promise<Pipe | null> {
		return helpers.findBy({ escrowWallet: wallet } as Partial<Pipe>);
	},

	async listEnabled(): Promise<Pipe[]> {
		return helpers.where({ enabled: true } as Partial<Pipe>);
	},

	async updateLastTriggered(id: string): Promise<Pipe> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return helpers.update(id, { lastTriggeredAt: new Date() } as any);
	}
};
