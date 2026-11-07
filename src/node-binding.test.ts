/**
 * Node ambient binding: AsyncLocalStorage plus the node-entry default, and
 * captured scope winning over it.
 */
import { describe, it, expect } from 'vitest';
import { Model, createScope, NoConnectionScopeError } from './index';
import {
	createActiveRecordJS,
	getGlobalConnection,
	runWithConnection,
	setGlobalConnection
} from './node';
import { fakeSession } from './fixtures/fake-session';
import { usersTable } from './fixtures/schema';
import { Post } from './fixtures/models';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs first, before anything in this file binds a node default.
describe('nothing bound', () => {
	it('unbound User.find throws before any driver select', async () => {
		const User = Model(usersTable);
		await expect(User.find(1)).rejects.toBeInstanceOf(NoConnectionScopeError);
		expect(() => getGlobalConnection()).toThrow(NoConnectionScopeError);
	});
});

describe('node default', () => {
	it('createActiveRecordJS binds a default; unbound User.find takes no scope argument', async () => {
		const log: string[] = [];
		const { Model: Factory } = createActiveRecordJS(fakeSession('A', log, { rows: [{ id: 1 }] }) as any);
		const User = Factory(usersTable);

		await User.find(1);

		expect(Factory).toBe(Model);
		expect(log).toEqual(['A:select']);
	});

	it('runWithConnection binds a context and restores the node default when it returns', async () => {
		const log: string[] = [];
		setGlobalConnection(fakeSession('A', log, { rows: [{ id: 1 }] }) as any);
		const User = Model(usersTable);

		await runWithConnection(fakeSession('B', log, { rows: [{ id: 1 }] }) as any, async () => {
			await User.find(1);
		});
		await User.find(1);

		expect(log).toEqual(['B:select', 'A:select']);
	});

	it('setGlobalConnection replaces the node default', async () => {
		const log: string[] = [];
		const User = Model(usersTable);
		setGlobalConnection(fakeSession('A', log, { rows: [{ id: 1 }] }) as any);
		await User.find(1);
		setGlobalConnection(fakeSession('B', log, { rows: [{ id: 1 }] }) as any);
		await User.find(1);
		expect(log).toEqual(['A:select', 'B:select']);
	});
});

describe('concurrent Node contexts', () => {
	it('each context uses the scope bound in it', async () => {
		const log: string[] = [];
		const a = fakeSession('A', log, { rows: [{ id: 1 }] });
		const b = fakeSession('B', log, { rows: [{ id: 1 }] });
		const User = Model(usersTable);
		const seen: string[] = [];

		await Promise.all([
			runWithConnection(a as any, async () => {
				await tick(5);
				await User.find(1);
				seen.push(`a:${log.at(-1)}`);
			}),
			runWithConnection(b as any, async () => {
				await User.find(1);
				await tick(10);
				await User.find(1);
				seen.push(`b:${log.at(-1)}`);
			})
		]);

		expect(log.filter((e) => e === 'A:select')).toHaveLength(1);
		expect(log.filter((e) => e === 'B:select')).toHaveLength(2);
		expect(seen.sort()).toEqual(['a:A:select', 'b:B:select']);
	});
});

describe('captured scope beats the ambient scope', () => {
	it('a model from scope.model stays on A under ambient B', async () => {
		const log: string[] = [];
		const a = createScope(fakeSession('A', log, { rows: [{ id: 1 }] }) as any);
		setGlobalConnection(fakeSession('D', log) as any);
		await runWithConnection(fakeSession('B', log) as any, async () => {
			await a.model(usersTable).find(1);
		});
		expect(log).toEqual(['A:select']);
	});

	it('a builder created under A runs on A when B is bound after an await', async () => {
		const log: string[] = [];
		const a = fakeSession('A', log, { rows: [{ id: 1 }] });
		const b = fakeSession('B', log, { rows: [{ id: 1 }] });
		const User = Model(usersTable);

		const builder = runWithConnection(a as any, () => User.where({ name: 'x' }));
		await tick();
		await runWithConnection(b as any, async () => {
			await builder.all();
			await builder.count();
		});

		expect(log).toEqual(['A:select', 'A:select']);
	});

	it('an instance loaded under A keeps A for hooks, associations, and save under B', async () => {
		const log: string[] = [];
		const a = fakeSession('A', log, { rows: [{ id: 1, userId: 2, title: 't' }] });
		const b = fakeSession('B', log, { rows: [{ id: 1, userId: 2, title: 't' }] });

		const post = await runWithConnection(a as any, () => Post.find(1));
		await runWithConnection(b as any, async () => {
			await post.user;
			await post.comments;
			await post.update({ title: 'u' });
		});

		expect(log.every((e) => e.startsWith('A:'))).toBe(true);
		expect(log).toContain('A:update');
	});

	it('inside a transaction, an unbound model call uses the callback scope', async () => {
		const log: string[] = [];
		setGlobalConnection(fakeSession('D', log) as any);
		const root = createScope(fakeSession('R', log, { rows: [{ id: 1 }] }) as any);
		const User = Model(usersTable);

		await root.transaction(async () => {
			await tick();
			await User.find(1);
		});

		expect(log).toEqual(['R:begin', 'R:tx:select', 'R:commit']);
	});
});
