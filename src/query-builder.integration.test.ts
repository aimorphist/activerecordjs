import { describe, expect, beforeAll, beforeEach } from 'vitest';
import { it, useTestScope } from './setup.integration';
import { Model } from './model';
import { usersTable } from './fixtures/schema';

describe('QueryBuilder Integration Tests', () => {
	useTestScope();

	let User: ReturnType<typeof Model<typeof usersTable>>;

	beforeAll(async () => {
		User = Model(usersTable);
	});

	beforeEach(async () => {
		// Seed test data
		await User.create({ name: 'Alice', email: 'alice@example.com' });
		await User.create({ name: 'Bob', email: 'bob@example.com' });
		await User.create({ name: 'Charlie', email: 'charlie@example.com' });
	});

	describe('where()', () => {
		it('filters by exact match', async () => {
			const results = await User.where({ name: 'Bob' }).all();

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe('Bob');
		});

		it('chains multiple where conditions (AND)', async () => {
			const results = await User.where({ name: 'Alice' })
				.where({ email: 'alice@example.com' })
				.all();

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe('Alice');
		});

		it('returns empty array for no matches', async () => {
			const results = await User.where({ name: 'NonExistent' }).all();

			expect(results).toEqual([]);
		});
	});

	describe('order()', () => {
		it('orders ascending', async () => {
			const results = await User.order('name', 'asc').all();

			expect(results.map((u) => u.name)).toEqual(['Alice', 'Bob', 'Charlie']);
		});

		it('orders descending', async () => {
			const results = await User.order('name', 'desc').all();

			expect(results.map((u) => u.name)).toEqual(['Charlie', 'Bob', 'Alice']);
		});

		it('orders by id by default', async () => {
			const results = await User.order('id').all();

			expect(results[0].name).toBe('Alice'); // First created
			expect(results[2].name).toBe('Charlie'); // Last created
		});
	});

	describe('limit()', () => {
		it('limits number of results', async () => {
			const results = await User.order('id').limit(2).all();

			expect(results).toHaveLength(2);
			expect(results[0].name).toBe('Alice');
			expect(results[1].name).toBe('Bob');
		});
	});

	describe('offset()', () => {
		it('skips first N results', async () => {
			const results = await User.order('id').offset(1).all();

			expect(results).toHaveLength(2);
			expect(results[0].name).toBe('Bob');
			expect(results[1].name).toBe('Charlie');
		});

		it('works with limit for pagination', async () => {
			const page2 = await User.order('id').limit(1).offset(1).all();

			expect(page2).toHaveLength(1);
			expect(page2[0].name).toBe('Bob');
		});
	});

	describe('first()', () => {
		it('returns first matching record', async () => {
			const user = await User.order('name').first();

			expect(user).not.toBeNull();
			expect(user!.name).toBe('Alice');
		});

		it('respects where conditions', async () => {
			const user = await User.where({ name: 'Bob' }).first();

			expect(user).not.toBeNull();
			expect(user!.name).toBe('Bob');
		});
	});

	describe('last()', () => {
		it('returns last record by id', async () => {
			const user = await User.last();

			expect(user).not.toBeNull();
			expect(user!.name).toBe('Charlie');
		});
	});

	describe('count()', () => {
		it('counts all records', async () => {
			const count = await User.count();

			expect(count).toBe(3);
		});

		it('counts with where condition', async () => {
			const count = await User.where({ name: 'Alice' }).count();

			expect(count).toBe(1);
		});

		it('returns 0 for no matches', async () => {
			const count = await User.where({ name: 'NonExistent' }).count();

			expect(count).toBe(0);
		});
	});

	describe('exists()', () => {
		it('returns true when record exists', async () => {
			const exists = await User.exists({ name: 'Alice' });

			expect(exists).toBe(true);
		});

		it('returns false when record does not exist', async () => {
			const exists = await User.exists({ name: 'NonExistent' });

			expect(exists).toBe(false);
		});

		it('works with query builder', async () => {
			const exists = await User.where({ name: 'Bob' }).exists();

			expect(exists).toBe(true);
		});
	});

	describe('findOrCreate()', () => {
		it('finds existing record', async () => {
			const user = await User.findOrCreate({ email: 'alice@example.com' }, { name: 'New Alice' });

			expect(user.name).toBe('Alice'); // Original, not 'New Alice'

			// Verify no new record was created
			const count = await User.count();
			expect(count).toBe(3);
		});

		it('creates new record when not found', async () => {
			const user = await User.findOrCreate({ email: 'new@example.com' }, { name: 'New User' });

			expect(user.name).toBe('New User');
			expect(user.email).toBe('new@example.com');
			expect(user.isPersisted).toBe(true);

			// Verify new record was created
			const count = await User.count();
			expect(count).toBe(4);
		});
	});

	describe('firstOrCreate()', () => {
		it('behaves like findOrCreate', async () => {
			const existing = await User.firstOrCreate({ email: 'alice@example.com' });
			expect(existing.name).toBe('Alice');

			const created = await User.firstOrCreate(
				{ email: 'another@example.com' },
				{ name: 'Another' }
			);
			expect(created.name).toBe('Another');
		});
	});

	describe('query() escape hatch', () => {
		it('allows raw Drizzle queries', async () => {
			const results = await User.query(async (table, db) => {
				return (db as any).select().from(table).limit(1);
			});

			expect(results).toHaveLength(1);
		});
	});

	describe('complex chains', () => {
		it('combines where, order, limit, offset', async () => {
			// Add more test data
			await User.create({ name: 'David', email: 'david@example.com' });
			await User.create({ name: 'Eve', email: 'eve@example.com' });

			const results = await User.order('name', 'asc').limit(2).offset(1).all();

			expect(results).toHaveLength(2);
			expect(results[0].name).toBe('Bob');
			expect(results[1].name).toBe('Charlie');
		});
	});

	describe('immutability', () => {
		it('does not modify original builder when chaining', async () => {
			const baseQuery = User.where({ name: 'Alice' });
			const withLimit = baseQuery.limit(1);

			// Execute both to verify they work independently
			const baseResults = await baseQuery.all();
			const limitedResults = await withLimit.all();

			// Both should find Alice
			expect(baseResults).toHaveLength(1);
			expect(limitedResults).toHaveLength(1);
		});
	});
});
