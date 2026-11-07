/**
 * ConnectionScope contract on fake sessions. Core only: this file never loads
 * the node entry, so there is no ambient scope here.
 */
import { describe, it, expect } from 'vitest';
import { Model, createScope, NoConnectionScopeError, ScopeClosedError, TransactionReentryError } from './index';
import type { ConnectionScope } from './index';
import { fakeSession } from './fixtures/fake-session';
import { usersTable, postsTable } from './fixtures/schema';
import { User as FixtureUser, Post as FixturePost } from './fixtures/models';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe('core binding without the node entry', () => {
	it('scope.model(table).find runs on that scope', async () => {
		const log: string[] = [];
		const scope = createScope(fakeSession('A', log, { rows: [{ id: 1, email: 'a@x' }] }) as any);
		const User = scope.model(usersTable);

		const user = await User.find(1);

		expect(user.email).toBe('a@x');
		expect(log).toEqual(['A:select']);
		expect(User.connectionScope).toBe(scope);
	});

	it('scope.model returns the same class per table, and rebinds an existing model class', async () => {
		const log: string[] = [];
		const scope = createScope(fakeSession('A', log, { rows: [{ id: 1, title: 't' }] }) as any);
		expect(scope.model(usersTable)).toBe(scope.model(usersTable));

		const Post = scope.model(FixturePost);
		expect(Post.belongsTo).toBe(FixturePost.belongsTo);
		const post = await Post.find(1);
		expect(post).toBeInstanceOf(FixturePost);
		expect(log).toEqual(['A:select']);
	});

	it('an unbound model with nothing bound throws before any driver call', async () => {
		const log: string[] = [];
		createScope(fakeSession('A', log) as any); // exists, but nothing is bound to it
		const User = Model(usersTable);

		await expect(User.find(1)).rejects.toBeInstanceOf(NoConnectionScopeError);
		await expect(User.where({ name: 'x' }).all()).rejects.toBeInstanceOf(NoConnectionScopeError);
		await expect(User.count()).rejects.toBeInstanceOf(NoConnectionScopeError);
		await expect(User.create({ email: 'e' })).rejects.toBeInstanceOf(NoConnectionScopeError);
		await expect(User.query(async () => 1)).rejects.toBeInstanceOf(NoConnectionScopeError);
		expect(log).toEqual([]);
	});

	it('run calls fn with the scope and does not retarget a model bound elsewhere', async () => {
		const log: string[] = [];
		const a = createScope(fakeSession('A', log, { rows: [{ id: 1 }] }) as any);
		const b = createScope(fakeSession('B', log, { rows: [{ id: 1 }] }) as any);
		const UserA = a.model(usersTable);

		await b.run(async (s) => {
			expect(s).toBe(b);
			await UserA.find(1);
		});

		expect(log).toEqual(['A:select']);
	});

	it('Model.query passes the bound session', async () => {
		const session = fakeSession('A');
		const scope = createScope(session as any);
		const got = await scope.model(usersTable).query(async (_table, db) => db);
		expect(got).toBe(session);
	});
});

describe('captured scope', () => {
	it('a builder keeps the scope of its model across awaits', async () => {
		const log: string[] = [];
		const a = createScope(fakeSession('A', log, { rows: [{ id: 1 }] }) as any);
		const builder = a.model(usersTable).where({ name: 'x' });
		await tick();
		await builder.all();
		expect(builder.scope).toBe(a);
		expect(log).toEqual(['A:select']);
	});

	it('a hydrated instance keeps its scope for save, reload, destroy, and belongs-to', async () => {
		const log: string[] = [];
		const a = createScope(fakeSession('A', log, { rows: [{ id: 1, userId: 7, title: 't' }] }) as any);
		const post = await a.model(FixturePost).find(1);
		expect(post._scope).toBe(a);

		await post.update({ title: 'u' });
		await post.reload();
		await post.user; // belongs-to on the owner's scope
		await post.comments; // has-many on the owner's scope
		await post.destroy();

		expect(log.every((entry) => entry.startsWith('A:'))).toBe(true);
		expect(log).toContain('A:update');
		expect(log).toContain('A:delete');
	});
});

describe('eager loader, collection proxies, and dependents use the owner scope', () => {
	it('includes, has-many, and HABTM work run on the captured scope only', async () => {
		const log: string[] = [];
		const a = createScope(
			fakeSession('A', log, { rows: [{ id: 1, userId: 1, postId: 1, tagId: 1, title: 't', email: 'e', count: 0 }] }) as any
		);
		const posts = await a.model(FixturePost).includes('user', 'comments', 'tags').all();
		const post = posts[0];
		await post.tags;
		await post.tags.count();
		await post.tags.add({ _data: { id: 1 } });
		await post.tags.remove({ _data: { id: 1 } });
		await post.tags.includes(1);
		await post.comments.ids();
		await post.comments.count();
		const user = await a.model(FixtureUser).find(1);
		await user.comments; // has-many through
		await user.profile; // has-one

		expect(log.length).toBeGreaterThan(10);
		expect(log.every((e) => e.startsWith('A:'))).toBe(true);
	});

	it('dependent nullify and destroy run on the owner scope inside a transaction', async () => {
		const log: string[] = [];
		const root = createScope(fakeSession('R', log, { rows: [{ id: 1, userId: 1 }] }) as any);
		class Owner extends Model(usersTable) {
			static hasMany = {
				posts: { model: () => FixturePost, dependent: 'nullify' as const }
			};
			static hasOne = {
				profile: { model: () => Model(postsTable), dependent: 'destroy' as const }
			};
		}
		await root.transaction(async (tx) => {
			const owner = await tx.model(Owner).find(1);
			await owner.destroy();
		});
		expect(log.filter((e) => e.startsWith('R:tx:'))).toEqual([
			'R:tx:select',
			'R:tx:select',
			'R:tx:delete',
			'R:tx:execute',
			'R:tx:delete'
		]);
		expect(log).not.toContain('R:select');
	});
});

describe('transaction', () => {
	it('the callback runs on the driver transaction session and keeps its lease across hook awaits', async () => {
		const log: string[] = [];
		const root = createScope(fakeSession('R', log, { rows: [{ id: 1, email: 'e' }] }) as any);
		const seen: Array<{ live: boolean | undefined; scope: ConnectionScope | null }> = [];

		class HookedUser extends Model(usersTable) {
			static beforeSave = [
				async (u: any) => {
					await tick();
					seen.push({ live: u._scope?.lease?.live, scope: u._scope });
				}
			];
		}

		let child!: ConnectionScope;
		const result = await root.transaction(async (tx) => {
			child = tx;
			expect(tx.lease?.live).toBe(true);
			const user = await tx.model(HookedUser).find(1);
			await tick();
			expect(tx.lease?.live).toBe(true);
			await user.save();
			expect(log.at(-1)).toBe('R:tx:update');
			expect(log).not.toContain('R:commit');
			return 'done';
		});

		expect(result).toBe('done');
		expect(seen).toEqual([{ live: true, scope: child }]);
		expect(log).toEqual(['R:begin', 'R:tx:select', 'R:tx:update', 'R:commit']);
		expect(child.lease?.live).toBe(false);
	});

	it('a belongs-to load and a hook inside the callback use the transaction session', async () => {
		const log: string[] = [];
		const root = createScope(fakeSession('R', log, { rows: [{ id: 1, userId: 2, title: 't', email: 'e' }] }) as any);
		const hookLookups: string[] = [];

		class HookedPost extends FixturePost {
			static beforeUpdate = [
				async (p: any) => {
					await tick();
					delete p._associations.user; // force a fresh related lookup from the hook
					const before = log.length;
					await p.user;
					hookLookups.push(...log.slice(before));
				}
			];
		}

		await root.transaction(async (tx) => {
			const post = await tx.model(HookedPost).find(1);
			await post.user;
			await post.update({ title: 'x' });
		});

		expect(hookLookups).toEqual(['R:tx:select']);
		expect(log).toEqual(['R:begin', 'R:tx:select', 'R:tx:select', 'R:tx:select', 'R:tx:update', 'R:commit']);
		expect(log).not.toContain('R:select');
	});

	it('a thrown callback rolls back, retires the token, and propagates', async () => {
		const log: string[] = [];
		const root = createScope(fakeSession('R', log) as any);
		let child!: ConnectionScope;
		await expect(
			root.transaction(async (tx) => {
				child = tx;
				await tick();
				throw new Error('boom');
			})
		).rejects.toThrow('boom');
		expect(log).toEqual(['R:begin', 'R:rollback']);
		expect(child.lease?.live).toBe(false);
	});

	it('a failed commit retires the token and propagates', async () => {
		const log: string[] = [];
		const root = createScope(fakeSession('R', log, { failCommit: true }) as any);
		let child!: ConnectionScope;
		await expect(root.transaction(async (tx) => (child = tx))).rejects.toThrow('commit failed');
		expect(child.lease?.live).toBe(false);
		// The root is free again afterwards.
		await expect(root.transaction(async () => 1)).rejects.toThrow('commit failed');
	});

	it('an escaped child or builder throws after commit without a driver call', async () => {
		const log: string[] = [];
		const root = createScope(fakeSession('R', log, { rows: [{ id: 1 }] }) as any);
		let child!: ConnectionScope;
		let builder: any;
		await root.transaction(async (tx) => {
			child = tx;
			builder = tx.model(usersTable).where({ name: 'x' });
		});
		const before = [...log];

		await expect(builder.all()).rejects.toBeInstanceOf(ScopeClosedError);
		await expect(child.model(usersTable).find(1)).rejects.toBeInstanceOf(ScopeClosedError);
		expect(() => child.session()).toThrow(ScopeClosedError);
		expect(log).toEqual(before);
	});
});

describe('nested transaction', () => {
	it('throws on the callback scope; the outer transaction stays the only one', async () => {
		const log: string[] = [];
		const root = createScope(fakeSession('R', log) as any);
		await root.transaction(async (tx) => {
			await expect(tx.transaction(async () => 1)).rejects.toBeInstanceOf(TransactionReentryError);
		});
		expect(log).toEqual(['R:begin', 'R:commit']);
	});

	it('throws on the same root while its callback is in progress', async () => {
		const log: string[] = [];
		const root = createScope(fakeSession('R', log) as any);
		await root.transaction(async () => {
			await expect(root.transaction(async () => 1)).rejects.toBeInstanceOf(TransactionReentryError);
		});
		expect(log.filter((e) => e === 'R:begin')).toHaveLength(1);
	});

	it('the root stays excluded until commit settles', async () => {
		const gate = deferred();
		const log: string[] = [];
		const root = createScope(fakeSession('R', log, { commitGate: gate.promise }) as any);
		const first = root.transaction(async () => 1);
		await tick(); // callback returned; commit pending
		expect(log).toEqual(['R:begin']);
		await expect(root.transaction(async () => 2)).rejects.toBeInstanceOf(TransactionReentryError);
		gate.resolve();
		await first;
		await expect(root.transaction(async () => 3)).resolves.toBe(3);
	});

	it('a different root begins its own transaction at the same time', async () => {
		const log: string[] = [];
		const a = createScope(fakeSession('A', log) as any);
		const b = createScope(fakeSession('B', log) as any);
		await a.transaction(async () => {
			await b.transaction(async (tx) => {
				expect(tx.lease?.live).toBe(true);
			});
		});
		expect(log).toEqual(['A:begin', 'B:begin', 'B:commit', 'A:commit']);
	});
});

describe('close ownership', () => {
	it('child close rejects further callback work and leaves the root client open', async () => {
		const log: string[] = [];
		let ended = false;
		const root = createScope(fakeSession('R', log, { rows: [{ id: 1 }] }) as any, {
			close: () => {
				ended = true;
			}
		});
		await root.transaction(async (tx) => {
			await tx.close();
			expect(tx.closed).toBe(true);
			await expect(tx.model(usersTable).find(1)).rejects.toBeInstanceOf(ScopeClosedError);
		});
		expect(ended).toBe(false);
		expect(root.closed).toBe(false);
		await root.model(usersTable).find(1);
		expect(log).toEqual(['R:begin', 'R:commit', 'R:select']);
	});

	it('root close during a callback rolls back, retires the token, then closes the client', async () => {
		const log: string[] = [];
		let child!: ConnectionScope;
		const root = createScope(fakeSession('R', log, { rows: [{ id: 1 }] }) as any, {
			close: () => {
				log.push(`close(token live=${child.lease?.live})`);
			}
		});
		const started = deferred();
		const release = deferred();
		const tx = root.transaction(async (scope) => {
			child = scope;
			started.resolve();
			await release.promise;
			// Further callback work after the root closed is rejected before the driver.
			await scope.model(usersTable).find(1);
		});
		await started.promise;

		const closing = root.close();
		await expect(tx).rejects.toBeInstanceOf(ScopeClosedError);
		await closing;
		release.resolve();
		await tick();

		expect(log).toEqual(['R:begin', 'R:rollback', 'close(token live=false)']);
		expect(child.lease?.live).toBe(false);
		expect(root.closed).toBe(true);
		expect(() => root.session()).toThrow(ScopeClosedError);
	});

	it('a closed root rejects transaction and model work', async () => {
		const log: string[] = [];
		const root = createScope(fakeSession('R', log) as any);
		await root.close();
		await expect(root.transaction(async () => 1)).rejects.toBeInstanceOf(ScopeClosedError);
		await expect(root.model(usersTable).find(1)).rejects.toBeInstanceOf(ScopeClosedError);
		expect(log).toEqual([]);
	});
});

describe('fixture models stay unbound', () => {
	it('FixtureUser has no scope of its own', () => {
		expect(FixtureUser.connectionScope).toBeNull();
		expect(Model(postsTable).connectionScope).toBeNull();
	});
});
