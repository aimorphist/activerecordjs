#!/usr/bin/env bun
/**
 * Interactive console for testing Bagpipe models and services.
 * Uses Bun's native REPL via child process.
 */

import { db, cleanup } from './lib/bootstrap';
import { createInterface } from 'readline';

import * as schema from '../src/lib/server/db/schema';

const { pipes, executions, claims } = schema;

import { eq } from 'drizzle-orm';
import { generateId, hashHex } from '../src/lib/server/utils/hash';
import { PipeNotFoundError } from '../src/lib/server/errors';

// Model helpers
function createModelHelpers<TTable, TSelect, TInsert>(table: TTable, idColumn: string = 'id') {
	const tableAny = table as any;

	return {
		async find(id: string): Promise<TSelect> {
			const [result] = await db.select().from(tableAny).where(eq(tableAny[idColumn], id)).limit(1);
			if (!result) throw new Error(`Record not found: ${id}`);
			return result as TSelect;
		},

		async findBy(attrs: Partial<TSelect>): Promise<TSelect | null> {
			let query: any = db.select().from(tableAny);
			for (const [key, value] of Object.entries(attrs)) {
				query = query.where(eq(tableAny[key], value));
			}
			const [result] = await query.limit(1);
			return (result as TSelect) ?? null;
		},

		async all(): Promise<TSelect[]> {
			return (await db.select().from(tableAny)) as TSelect[];
		},

		async create(attrs: TInsert): Promise<TSelect> {
			const now = new Date();
			const data = { ...attrs, createdAt: now, updatedAt: now };
			const [result] = await db.insert(tableAny).values(data).returning();
			return result as TSelect;
		},

		async update(id: string, attrs: Partial<TInsert>): Promise<TSelect> {
			const data = { ...attrs, updatedAt: new Date() };
			const [result] = await db
				.update(tableAny)
				.set(data)
				.where(eq(tableAny[idColumn], id))
				.returning();
			if (!result) throw new Error(`Record not found: ${id}`);
			return result as TSelect;
		},

		async destroy(id: string): Promise<void> {
			await db.delete(tableAny).where(eq(tableAny[idColumn], id));
		},

		async where(attrs: Partial<TSelect>): Promise<TSelect[]> {
			let query: any = db.select().from(tableAny);
			for (const [key, value] of Object.entries(attrs)) {
				query = query.where(eq(tableAny[key], value));
			}
			return (await query) as TSelect[];
		}
	};
}

// PipeModel
const pipeHelpers = createModelHelpers<typeof pipes, schema.Pipe, schema.NewPipe>(pipes);

const PipeModel = {
	...pipeHelpers,
	async find(id: string) {
		try {
			return await pipeHelpers.find(id);
		} catch {
			throw new PipeNotFoundError(id);
		}
	},
	async create(input: {
		name?: string;
		escrowWallet: string;
		controllerType: 'wallet' | 'multisig' | 'program' | 'mjolnir';
		controllerId: string;
		deciderType?: 'static' | 'lambda';
		deciderConfig?: object;
		destinations?: object[];
		triggerMode?: object;
		retryPolicy?: object;
		enabled?: boolean;
	}) {
		const id = generateId('pipe', {
			escrowWallet: input.escrowWallet,
			controllerType: input.controllerType,
			controllerId: input.controllerId
		});

		return pipeHelpers.create({
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
	async findByEscrowWallet(wallet: string) {
		return pipeHelpers.findBy({ escrowWallet: wallet } as any);
	},
	async listEnabled() {
		return pipeHelpers.where({ enabled: true } as any);
	}
};

// ExecutionModel
const executionHelpers = createModelHelpers<
	typeof executions,
	schema.Execution,
	schema.NewExecution
>(executions);

const ExecutionModel = {
	...executionHelpers,
	async create(input: {
		pipeId: string;
		triggerType: 'manual' | 'threshold' | 'cron';
		balanceBefore?: bigint;
		splBalancesBefore?: Record<string, string>;
	}) {
		const id = generateId('exec', { pipeId: input.pipeId, timestamp: Date.now() });

		return executionHelpers.create({
			id,
			pipeId: input.pipeId,
			status: 'pending',
			triggerType: input.triggerType,
			triggeredAt: new Date(),
			balanceBefore: input.balanceBefore ?? null,
			splBalancesBefore: input.splBalancesBefore ?? null
		});
	},
	async forPipe(pipeId: string) {
		return executionHelpers.where({ pipeId } as any);
	}
};

import { SolanaService, EnvWalletService } from '../src/lib/server/services';
import { loadConfig } from '../src/lib/server/config';

// ActiveRecordJS Model for testing
import { Model, setGlobalConnection, ValidationError, z } from '../src/lib/activerecordjs';
import { usersTable, postsTable } from '../src/lib/activerecordjs/fixtures/schema';
setGlobalConnection(db as any);

// Make available globally
const context = {
	db,
	pipes,
	executions,
	claims,
	PipeModel,
	ExecutionModel,
	SolanaService,
	EnvWalletService,
	loadConfig,
	generateId,
	hashHex,
	eq,
	// ActiveRecordJS
	Model,
	ValidationError,
	z,
	usersTable,
	postsTable
};

Object.assign(globalThis, context);

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    Bagpipe Console                            ║
╠═══════════════════════════════════════════════════════════════╣
║  db, PipeModel, ExecutionModel, pipes, executions, claims     ║
║  SolanaService, EnvWalletService, loadConfig, generateId, eq  ║
║  Model, ValidationError, z, usersTable, postsTable            ║
╚═══════════════════════════════════════════════════════════════╝

Try: await PipeModel.all()
     const User = Model(usersTable)
     User.build({ email: 'test@example.com' })
`);

// Simple REPL using readline
const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: true
});

// Shared REPL context - variables persist across commands
const replContext: Record<string, any> = { ...context };

// Evaluate code within the replContext scope
async function evalCode(code: string): Promise<any> {
	// Transform variable declarations to context assignments
	// const/let/var name = expr  ->  replContext.name = expr
	const transformed = code.replace(
		/^(const|let|var)\s+(\w+)\s*=/,
		(_, __, name) => `replContext.${name} =`
	);

	// Create evaluator function with replContext in scope
	const asyncEval = (c: string) => {
		// Use indirect eval to get global scope, but with our context accessible
		const evalInContext = new Function(
			'replContext',
			`with(replContext) { return eval(${JSON.stringify(c)}); }`
		);
		return evalInContext(replContext);
	};

	try {
		// Try as async expression first
		const result = await asyncEval(`(async () => (${transformed}))()`);
		return result;
	} catch {
		// Try as async statements
		try {
			const result = await asyncEval(`(async () => { ${transformed} })()`);
			return result;
		} catch (e: any) {
			throw e;
		}
	}
}

function prompt() {
	rl.question('bagpipe> ', async (input) => {
		const code = input.trim();

		if (!code) {
			prompt();
			return;
		}

		if (code === '.exit' || code === 'exit') {
			console.log('Goodbye!');
			await cleanup();
			process.exit(0);
		}

		try {
			const result = await evalCode(code);
			if (result !== undefined) {
				console.dir(result, { depth: 4, colors: true });
			}
		} catch (e: any) {
			console.error('Error:', e.message);
		}

		prompt();
	});
}

prompt();
