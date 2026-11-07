/**
 * The PGlite adapter against a real PGlite database. Run with `bun run test:pglite`.
 * No docker: one memory database for the model operations and the lease, one
 * directory for the reopen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordNotFoundError, ScopeClosedError, TransactionReentryError } from './errors';
import type { ConnectionScope } from './index';
import './node'; // installs the ambient binding, so re-entry from inside the holder is visible
import {
	assertSessionSafe,
	LeaseTimeoutError,
	openPglite,
	PgliteSessionStateError
} from './pglite';
import { usersTable } from './fixtures/schema';
import { Post as FixturePost } from './fixtures/models';

/** Drizzle wraps a driver-side throw in DrizzleQueryError; the original is its cause. */
const causeOf = (error: any) => error?.cause ?? error;
const rejection = (promise: Promise<unknown>) =>
	promise.then(
		() => null,
		(error) => causeOf(error)
	);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DDL = [
	`create table users (
		id serial primary key, name text, email text not null,
		created_at timestamp default now(), updated_at timestamp default now())`,
	`create table posts (
		id serial primary key, title text not null, body text,
		user_id integer references users(id),
		created_at timestamp default now(), updated_at timestamp default now())`
];

async function createTables(scope: ConnectionScope) {
	for (const statement of DDL) await scope.session().execute(sql.raw(statement));
}

async function show(session: { execute: (q: any) => Promise<any> }, setting: string): Promise<string> {
	const result = await session.execute(sql.raw(`show ${setting}`));
	return Object.values(result.rows[0])[0] as string;
}

describe('memory database: model operations', () => {
	let scope: ConnectionScope;
	beforeAll(async () => {
		scope = await openPglite();
		await createTables(scope);
	});
	afterAll(() => scope.close());

	it('create, find, update, destroy', async () => {
		const User = scope.model(usersTable);

		const created = await User.create({ email: 'ada@example.com', name: 'Ada' });
		expect(created.id).toBeTypeOf('number');

		const found = await User.find(created.id as number);
		expect(found.email).toBe('ada@example.com');

		await found.update({ name: 'Ada L.' });
		expect((await User.find(created.id as number)).name).toBe('Ada L.');

		await found.destroy();
		await expect(User.find(created.id as number)).rejects.toBeInstanceOf(RecordNotFoundError);
	});

	it('a transaction that throws rolls back; one that returns commits', async () => {
		const User = scope.model(usersTable);
		const before = await User.count();

		await expect(
			scope.transaction(async (tx) => {
				await tx.model(usersTable).create({ email: 'gone@example.com' });
				throw new Error('abort');
			})
		).rejects.toThrow('abort');
		expect(await User.count()).toBe(before);

		await scope.transaction(async (tx) => {
			await tx.model(usersTable).create({ email: 'kept@example.com' });
		});
		expect(await User.count()).toBe(before + 1);
	});

	it('loads one association', async () => {
		const Post = scope.model(FixturePost);
		const user = await scope.model(usersTable).create({ email: 'author@example.com', name: 'Author' });
		const post = await Post.create({ title: 'Hello', userId: user.id });

		const loaded = await post.user;
		expect(loaded.id).toBe(user.id);
		expect(loaded.email).toBe('author@example.com');
	});
});

describe('exclusive lease (400ms wait)', () => {
	let scope: ConnectionScope;
	beforeAll(async () => {
		scope = await openPglite({ leaseTimeoutMs: 400 });
		await createTables(scope);
	});
	afterAll(() => scope.close());

	it('a second transaction waits for the first to settle', async () => {
		const log: string[] = [];
		const first = scope.transaction(async () => {
			log.push('first begin');
			await sleep(100);
			log.push('first end');
		});
		await sleep(10);
		const second = scope.transaction(async () => {
			log.push('second begin');
		});
		await Promise.all([first, second]);
		expect(log).toEqual(['first begin', 'first end', 'second begin']);
	});

	it('the holder runs statements at once while another transaction is queued', async () => {
		const log: string[] = [];
		let release!: () => void;
		const proceed = new Promise<void>((resolve) => (release = resolve));
		const holder = scope.transaction(async (tx) => {
			await proceed;
			await tx.session().execute(sql`select 1`);
			log.push('holder statement');
			await tx.model(usersTable).create({ email: 'holder@example.com' });
			log.push('holder insert');
		});
		await sleep(10);
		// Queued from outside the holder's async context: a waiter, not a nested call.
		const queued = scope.transaction(async () => {
			log.push('queued begin');
		});
		await sleep(20);
		release();
		await Promise.all([holder, queued]);
		expect(log).toEqual(['holder statement', 'holder insert', 'queued begin']);
	});

	it('autocommit waits while a transaction is open, and sees only what it committed', async () => {
		const User = scope.model(usersTable);
		const before = await User.count();
		const log: string[] = [];
		const tx = scope.transaction(async (t) => {
			await t.model(usersTable).create({ email: 'transient@example.com' });
			await sleep(100);
			log.push('tx rolls back');
			throw new Error('rollback');
		});
		await sleep(10);
		const outside = User.count().then((n) => {
			log.push(`autocommit count ${n}`);
			return n;
		});
		await expect(tx).rejects.toThrow('rollback');
		expect(await outside).toBe(before);
		expect(log).toEqual(['tx rolls back', `autocommit count ${before}`]);
	});

	it('a timed-out wait rolls back the open transaction, releases the lease, and names the timeout', async () => {
		const User = scope.model(usersTable);
		const before = await User.count();
		let stray: unknown = null;
		const open = scope.transaction(async (tx) => {
			await tx.model(usersTable).create({ email: 'stuck@example.com' });
			await sleep(800);
			try {
				await tx.model(usersTable).count();
			} catch (error) {
				stray = error;
			}
		});
		const openOutcome = open.then(
			() => null,
			(e) => e
		);
		await sleep(10);

		const started = Date.now();
		const waiter = await scope
			.transaction(async () => 'never')
			.then(
				() => null,
				(e) => e
			);
		const waited = Date.now() - started;

		expect(waiter).toBeInstanceOf(LeaseTimeoutError);
		expect(waiter.message).toMatch(/timed out after 400ms/);
		expect(waited).toBeGreaterThanOrEqual(350);
		expect(await openOutcome).toBeInstanceOf(LeaseTimeoutError);

		// Rolled back, lease free: the next caller enters at once and the row is gone.
		expect(await User.count()).toBe(before);
		await expect(scope.transaction(async () => 'ok')).resolves.toBe('ok');

		// The abandoned callback's later statement is refused, not applied.
		await sleep(900);
		expect(stray).toBeInstanceOf(ScopeClosedError);
		expect(await User.count()).toBe(before);
	});

	it('an autocommit call from inside a transaction waits behind its own lease, so the timeout rolls it back', async () => {
		const User = scope.model(usersTable);
		const before = await User.count();
		const outcome = await rejection(
			scope.transaction(async (tx) => {
				await tx.model(usersTable).create({ email: 'self-wait@example.com' });
				// scope.model is bound to the root, not to tx: this is another caller's autocommit.
				await User.count();
			})
		);
		expect(outcome).toBeInstanceOf(LeaseTimeoutError);
		expect(await User.count()).toBe(before);
	});

	it('nested transaction throws; the waiter is not treated as nested', async () => {
		await scope.transaction(async (tx) => {
			await expect(tx.transaction(async () => 1)).rejects.toBeInstanceOf(TransactionReentryError);
			// Same root, from inside the holder's async context.
			await expect(scope.transaction(async () => 1)).rejects.toBeInstanceOf(TransactionReentryError);
			await tx.model(usersTable).create({ email: 'outer@example.com' });
		});
		const outer = await scope.model(usersTable).where({ email: 'outer@example.com' }).all();
		expect(outer).toHaveLength(1);
	});
});

describe('session state', () => {
	let scope: ConnectionScope;
	beforeAll(async () => {
		scope = await openPglite();
	});
	afterAll(() => scope.close());

	it('rejects SET, temporary tables, and advisory locks, and does not apply them', async () => {
		const session = scope.session();
		expect(await rejection(session.execute(sql`set statement_timeout = 1234`))).toBeInstanceOf(
			PgliteSessionStateError
		);
		expect(await rejection(session.execute(sql`create temp table scratch (id int)`))).toBeInstanceOf(
			PgliteSessionStateError
		);
		expect(await rejection(session.execute(sql`select pg_advisory_lock(1)`))).toBeInstanceOf(
			PgliteSessionStateError
		);
		expect(await show(session, 'statement_timeout')).toBe('0');
		expect(
			await rejection(
				scope.transaction(async (tx) => {
					await tx.session().execute(sql`set statement_timeout = 1234`);
				})
			)
		).toBeInstanceOf(PgliteSessionStateError);
		expect(await show(session, 'statement_timeout')).toBe('0');
	});

	it('allows SET LOCAL while the lease is held, and it ends with the transaction', async () => {
		await scope.transaction(async (tx) => {
			await tx.session().execute(sql`set local statement_timeout = '1234ms'`);
			expect(await show(tx.session(), 'statement_timeout')).toBe('1234ms');
		});
		expect(await show(scope.session(), 'statement_timeout')).toBe('0');
	});

	it('the guard reads statements, not substrings', () => {
		expect(() => assertSessionSafe("select 'set x', 'pg_advisory_lock' as note")).not.toThrow();
		expect(() => assertSessionSafe('/* set x */ select 1 -- create temp table t')).not.toThrow();
		expect(() => assertSessionSafe('select 1; set local x = 1')).not.toThrow();
		expect(() => assertSessionSafe("select set_config('x', 'y', true)")).not.toThrow();
		expect(() => assertSessionSafe('select 1; SET x = 1')).toThrow(PgliteSessionStateError);
		expect(() => assertSessionSafe('  SET SESSION x = 1')).toThrow(PgliteSessionStateError);
		expect(() => assertSessionSafe('RESET ALL')).toThrow(PgliteSessionStateError);
		expect(() => assertSessionSafe('create global temporary table t (id int)')).toThrow(
			PgliteSessionStateError
		);
		expect(() => assertSessionSafe('select * into temp t from users')).toThrow(PgliteSessionStateError);
		expect(() => assertSessionSafe("select set_config('x', 'y', false)")).toThrow(PgliteSessionStateError);
		expect(() => assertSessionSafe('select pg_try_advisory_xact_lock(1)')).toThrow(PgliteSessionStateError);
	});
});

describe('close', () => {
	it('rolls back an open transaction and rejects a queued waiter', async () => {
		const scope = await openPglite({ leaseTimeoutMs: 5000 });
		await createTables(scope);
		const open = scope.transaction(async (tx) => {
			await tx.model(usersTable).create({ email: 'closing@example.com' });
			await sleep(5000);
		});
		const openOutcome = open.then(
			() => null,
			(e) => e
		);
		await sleep(20);
		const waiter = scope.transaction(async () => 1).then(
			() => null,
			(e) => e
		);
		await scope.close();
		expect(await openOutcome).toBeInstanceOf(ScopeClosedError);
		expect(await waiter).toBeInstanceOf(ScopeClosedError);
		expect(scope.closed).toBe(true);
	});
});

describe('directory database: reopen', () => {
	let dir: string;
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), 'arjs-pglite-'));
	});
	afterAll(() => rm(dir, { recursive: true, force: true }));

	it('shows the committed row and not the rolled-back row', async () => {
		const first = await openPglite({ dataDir: dir });
		await createTables(first);
		await first.transaction(async (tx) => {
			await tx.model(usersTable).create({ email: 'committed@example.com' });
		});
		await expect(
			first.transaction(async (tx) => {
				await tx.model(usersTable).create({ email: 'rolled-back@example.com' });
				throw new Error('abort');
			})
		).rejects.toThrow('abort');
		await first.close();
		expect(first.closed).toBe(true);

		const second = await openPglite({ dataDir: dir });
		try {
			const User = second.model(usersTable);
			const emails = (await User.all()).map((u: any) => u.email);
			expect(emails).toEqual(['committed@example.com']);
		} finally {
			await second.close();
		}
	});
});
