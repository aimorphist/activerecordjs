import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Model } from './model';
import { setGlobalConnection } from './connection';
import { users } from './fixtures/schema';

// Mock database (same pattern as model.test.ts)
function createMockDb() {
	const mockResults: any[] = [];

	// Make query thenable so it can be awaited directly
	const mockQuery: any = {
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		orderBy: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		offset: vi.fn().mockReturnThis(),
		values: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		returning: vi.fn().mockImplementation(() => Promise.resolve(mockResults)),
		// Make query thenable for direct await
		then: (resolve: (value: any) => void) => Promise.resolve(mockResults).then(resolve)
	};

	const db = {
		select: vi.fn().mockReturnValue(mockQuery),
		insert: vi.fn().mockReturnValue(mockQuery),
		update: vi.fn().mockReturnValue(mockQuery),
		delete: vi.fn().mockReturnValue(mockQuery),
		_setResults: (results: any[]) => {
			mockResults.length = 0;
			mockResults.push(...results);
		},
		_mockQuery: mockQuery
	};

	return db;
}

describe('QueryBuilder', () => {
	let db: ReturnType<typeof createMockDb>;
	let User: ReturnType<typeof Model<typeof users>>;

	beforeEach(() => {
		db = createMockDb();
		setGlobalConnection(db as any);
		User = Model(users);
	});

	describe('where()', () => {
		it('filters by hash conditions', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const results = await User.where({ name: 'Duke' }).all();

			expect(results).toHaveLength(1);
			expect(results[0].name).toBe('Duke');
			expect(db._mockQuery.where).toHaveBeenCalled();
		});

		it('supports multiple where() calls (AND)', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			await User.where({ name: 'Duke' }).where({ email: 'duke@example.com' }).all();

			expect(db._mockQuery.where).toHaveBeenCalledTimes(2);
		});

		it('supports raw SQL conditions', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			await User.where('age > ?', 18).all();

			expect(db._mockQuery.where).toHaveBeenCalled();
		});

		it('is immutable - does not modify original builder', async () => {
			db._setResults([]);

			const base = User.where({ name: 'Active' });
			const withName = base.where({ name: 'Duke' });

			// They should be different builders
			expect(base).not.toBe(withName);
		});
	});

	describe('order()', () => {
		it('orders by column ascending by default', async () => {
			db._setResults([
				{ id: 1, name: 'Alice' },
				{ id: 2, name: 'Bob' }
			]);

			await User.order('name').all();

			expect(db._mockQuery.orderBy).toHaveBeenCalled();
		});

		it('orders by column descending', async () => {
			db._setResults([]);

			await User.order('createdAt', 'desc').all();

			expect(db._mockQuery.orderBy).toHaveBeenCalled();
		});

		it('supports multiple order() calls', async () => {
			db._setResults([]);

			await User.order('name', 'asc').order('createdAt', 'desc').all();

			expect(db._mockQuery.orderBy).toHaveBeenCalledTimes(2);
		});
	});

	describe('limit()', () => {
		it('limits results', async () => {
			db._setResults([{ id: 1, name: 'Duke' }]);

			await User.limit(5).all();

			expect(db._mockQuery.limit).toHaveBeenCalledWith(5);
		});
	});

	describe('offset()', () => {
		it('offsets results', async () => {
			db._setResults([]);

			await User.offset(10).all();

			expect(db._mockQuery.offset).toHaveBeenCalledWith(10);
		});
	});

	describe('chaining', () => {
		it('combines where, order, limit, offset', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const results = await User.where({ name: 'Active' })
				.order('createdAt', 'desc')
				.limit(10)
				.offset(20)
				.all();

			expect(results).toHaveLength(1);
			expect(db._mockQuery.where).toHaveBeenCalled();
			expect(db._mockQuery.orderBy).toHaveBeenCalled();
			expect(db._mockQuery.limit).toHaveBeenCalledWith(10);
			expect(db._mockQuery.offset).toHaveBeenCalledWith(20);
		});
	});

	describe('first()', () => {
		it('returns first matching record', async () => {
			db._setResults([{ id: 1, name: 'First' }]);

			const user = await User.where({ name: 'Active' }).first();

			expect(user).not.toBeNull();
			expect(user!.name).toBe('First');
			expect(db._mockQuery.limit).toHaveBeenCalledWith(1);
		});

		it('returns null when no match', async () => {
			db._setResults([]);

			const user = await User.where({ name: 'Active' }).first();

			expect(user).toBeNull();
		});
	});

	describe('last()', () => {
		it('returns last matching record', async () => {
			db._setResults([{ id: 100, name: 'Last' }]);

			const user = await User.where({ name: 'Active' }).last();

			expect(user).not.toBeNull();
			expect(user!.name).toBe('Last');
		});
	});

	describe('count()', () => {
		it('returns count of matching records', async () => {
			db._setResults([{ count: 42 }]);

			const count = await User.where({ name: 'Active' }).count();

			expect(count).toBe(42);
		});

		it('returns 0 for empty result', async () => {
			db._setResults([{ count: 0 }]);

			const count = await User.where({ name: 'Inactive' }).count();

			expect(count).toBe(0);
		});

		it('works without where clause', async () => {
			db._setResults([{ count: 100 }]);

			const count = await User.count();

			expect(count).toBe(100);
		});
	});

	describe('exists()', () => {
		it('returns true when records match', async () => {
			db._setResults([{ count: 1 }]);

			const exists = await User.exists({ email: 'duke@example.com' });

			expect(exists).toBe(true);
		});

		it('returns false when no records match', async () => {
			db._setResults([{ count: 0 }]);

			const exists = await User.exists({ email: 'nonexistent@example.com' });

			expect(exists).toBe(false);
		});

		it('works with query builder', async () => {
			db._setResults([{ count: 1 }]);

			const exists = await User.where({ name: 'Active' }).exists();

			expect(exists).toBe(true);
		});
	});

	describe('findOrCreate()', () => {
		it('returns existing record if found', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = await User.findOrCreate({ email: 'duke@example.com' }, { name: 'New Duke' });

			expect(user.id).toBe(1);
			expect(user.name).toBe('Duke'); // Original name, not 'New Duke'
			expect(db.insert).not.toHaveBeenCalled();
		});

		it('creates new record if not found', async () => {
			// First query returns empty (not found)
			db._setResults([]);

			// Mock will be called for insert, set up return value
			const insertResult = { id: 1, name: 'Duke', email: 'duke@example.com' };
			db._mockQuery.returning.mockImplementationOnce(() => Promise.resolve([insertResult]));

			const user = await User.findOrCreate({ email: 'duke@example.com' }, { name: 'Duke' });

			expect(db.insert).toHaveBeenCalled();
			expect(user.email).toBe('duke@example.com');
		});

		it('merges find and create attributes', async () => {
			db._setResults([]);

			const insertResult = { id: 1, name: 'Duke', email: 'duke@example.com' };
			db._mockQuery.returning.mockImplementationOnce(() => Promise.resolve([insertResult]));

			await User.findOrCreate({ email: 'duke@example.com' }, { name: 'Duke' });

			// Verify insert was called with merged attributes
			expect(db._mockQuery.values).toHaveBeenCalled();
		});
	});

	describe('firstOrCreate()', () => {
		it('is an alias for findOrCreate', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = await User.firstOrCreate({ email: 'duke@example.com' });

			expect(user.id).toBe(1);
		});
	});

	describe('query() escape hatch', () => {
		it('provides access to table and db', async () => {
			const mockResult = [{ id: 1, custom: 'data' }];

			const result = await User.query(async (table, db) => {
				// User has direct access to Drizzle table and db
				expect(table).toBeDefined();
				expect(db).toBeDefined();
				return mockResult;
			});

			expect(result).toEqual(mockResult);
		});
	});
});
