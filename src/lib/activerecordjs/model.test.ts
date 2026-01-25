import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Model } from './model';
import { setGlobalConnection } from './connection';
import { RecordNotFoundError } from './errors';
import { usersTable } from './fixtures/schema';

// Mock database
function createMockDb() {
	const mockResults: any[] = [];

	// Make query thenable so it can be awaited directly (for all())
	const mockQuery: any = {
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		orderBy: vi.fn().mockReturnThis(),
		limit: vi.fn().mockImplementation(() => Promise.resolve(mockResults)),
		values: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		returning: vi.fn().mockImplementation(() => Promise.resolve(mockResults)),
		// Make query thenable for direct await (all() doesn't use limit())
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

describe('Model()', () => {
	let db: ReturnType<typeof createMockDb>;
	let User: ReturnType<typeof Model<typeof users>>;

	beforeEach(() => {
		db = createMockDb();
		setGlobalConnection(db as any);
		User = Model(usersTable);
	});

	describe('convention detection', () => {
		it('detects table name', () => {
			expect(User.tableName).toBe('users');
		});

		it('detects primary key', () => {
			expect(User.primaryKey).toBe('id');
		});

		it('detects timestamp columns', () => {
			expect(User.timestamps.createdAt).toBe('createdAt');
			expect(User.timestamps.updatedAt).toBe('updatedAt');
		});
	});

	describe('find()', () => {
		it('returns model instance when found', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = await User.find(1);

			expect(user.id).toBe(1);
			expect(user.name).toBe('Duke');
			expect(user.email).toBe('duke@example.com');
		});

		it('throws RecordNotFoundError when not found', async () => {
			db._setResults([]);

			await expect(User.find(999)).rejects.toThrow(RecordNotFoundError);
			await expect(User.find(999)).rejects.toThrow('users with id 999 not found');
		});

		it('marks instance as persisted', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = await User.find(1);

			expect(user.isPersisted).toBe(true);
			expect(user.isNewRecord).toBe(false);
		});
	});

	describe('findBy()', () => {
		it('returns model instance when found', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = await User.findBy({ email: 'duke@example.com' });

			expect(user).not.toBeNull();
			expect(user!.email).toBe('duke@example.com');
		});

		it('returns null when not found', async () => {
			db._setResults([]);

			const user = await User.findBy({ email: 'nonexistent@example.com' });

			expect(user).toBeNull();
		});

		it('supports multiple attributes', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			await User.findBy({ name: 'Duke', email: 'duke@example.com' });

			expect(db._mockQuery.where).toHaveBeenCalledTimes(2);
		});
	});

	describe('all()', () => {
		it('returns all records as model instances', async () => {
			db._setResults([
				{ id: 1, name: 'Duke', email: 'duke@example.com' },
				{ id: 2, name: 'Jane', email: 'jane@example.com' }
			]);

			const allUsers = await User.all();

			expect(allUsers).toHaveLength(2);
			expect(allUsers[0].name).toBe('Duke');
			expect(allUsers[1].name).toBe('Jane');
		});

		it('returns empty array when no records', async () => {
			db._setResults([]);

			const allUsers = await User.all();

			expect(allUsers).toEqual([]);
		});

		it('marks all instances as persisted', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const allUsers = await User.all();

			expect(allUsers[0].isPersisted).toBe(true);
		});
	});

	describe('first()', () => {
		it('returns first record ordered by primary key', async () => {
			db._setResults([{ id: 1, name: 'First', email: 'first@example.com' }]);

			const user = await User.first();

			expect(user).not.toBeNull();
			expect(user!.name).toBe('First');
			expect(db._mockQuery.orderBy).toHaveBeenCalled();
		});

		it('returns null when no records', async () => {
			db._setResults([]);

			const user = await User.first();

			expect(user).toBeNull();
		});
	});

	describe('last()', () => {
		it('returns last record ordered by primary key desc', async () => {
			db._setResults([{ id: 100, name: 'Last', email: 'last@example.com' }]);

			const user = await User.last();

			expect(user).not.toBeNull();
			expect(user!.name).toBe('Last');
			expect(db._mockQuery.orderBy).toHaveBeenCalled();
		});

		it('returns null when no records', async () => {
			db._setResults([]);

			const user = await User.last();

			expect(user).toBeNull();
		});
	});

	describe('build() / new()', () => {
		it('creates unpersisted instance', () => {
			const user = User.build({ name: 'Duke', email: 'duke@example.com' });

			expect(user.name).toBe('Duke');
			expect(user.email).toBe('duke@example.com');
			expect(user.isNewRecord).toBe(true);
			expect(user.isPersisted).toBe(false);
		});

		it('allows attribute modification', () => {
			const user = User.build({ name: 'Duke' });

			user.name = 'Modified';

			expect(user.name).toBe('Modified');
		});

		it('handles empty attributes', () => {
			const user = User.build();

			expect(user.isNewRecord).toBe(true);
			expect(user.name).toBeUndefined();
		});

		it('new() is an alias for build()', () => {
			const user = User['new']({ name: 'Duke', email: 'duke@example.com' });

			expect(user.name).toBe('Duke');
			expect(user.isNewRecord).toBe(true);
		});
	});

	// Phase 4: Write Operations

	describe('create()', () => {
		it('creates and persists a new record', async () => {
			db._setResults([
				{
					id: 1,
					name: 'Duke',
					email: 'duke@example.com',
					createdAt: new Date(),
					updatedAt: new Date()
				}
			]);

			const user = await User.create({ name: 'Duke', email: 'duke@example.com' });

			expect(user.id).toBe(1);
			expect(user.isPersisted).toBe(true);
			expect(db.insert).toHaveBeenCalled();
		});

		it('auto-sets createdAt timestamp', async () => {
			const now = new Date();
			db._setResults([
				{ id: 1, name: 'Duke', email: 'duke@example.com', createdAt: now, updatedAt: now }
			]);

			await User.create({ name: 'Duke', email: 'duke@example.com' });

			expect(db._mockQuery.values).toHaveBeenCalled();
		});
	});

	describe('save()', () => {
		describe('new record', () => {
			it('inserts the record', async () => {
				db._setResults([
					{
						id: 1,
						name: 'Duke',
						email: 'duke@example.com',
						createdAt: new Date(),
						updatedAt: new Date()
					}
				]);

				const user = User.build({ name: 'Duke', email: 'duke@example.com' });
				await user.save();

				expect(user.isPersisted).toBe(true);
				expect(db.insert).toHaveBeenCalled();
			});

			it('updates id after insert', async () => {
				db._setResults([{ id: 42, name: 'Duke', email: 'duke@example.com' }]);

				const user = User.build({ name: 'Duke', email: 'duke@example.com' });
				expect(user.id).toBeUndefined();

				await user.save();

				expect(user.id).toBe(42);
			});
		});

		describe('existing record', () => {
			it('updates the record', async () => {
				// First, simulate finding an existing record
				db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
				const user = await User.find(1);

				// Then update
				db._setResults([]);
				user.name = 'Modified';
				await user.save();

				expect(db.update).toHaveBeenCalled();
			});

			it('auto-updates updatedAt timestamp', async () => {
				db._setResults([
					{ id: 1, name: 'Duke', email: 'duke@example.com', updatedAt: new Date('2020-01-01') }
				]);
				const user = await User.find(1);

				db._setResults([]);

				user.name = 'Modified';
				await user.save();

				// The updatedAt should have been set to a new value in the update call
				expect(db._mockQuery.set).toHaveBeenCalled();
			});
		});

		it('returns the instance for chaining', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = User.build({ name: 'Duke', email: 'duke@example.com' });
			const result = await user.save();

			// Check that chaining works - result has the same state
			expect(result.id).toBe(user.id);
			expect(result.isPersisted).toBe(user.isPersisted);
		});
	});

	describe('update() instance method', () => {
		it('updates attributes and saves', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await User.find(1);

			db._setResults([]);
			await user.update({ name: 'New Name' });

			expect(user.name).toBe('New Name');
			expect(db.update).toHaveBeenCalled();
		});

		it('returns the instance for chaining', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await User.find(1);

			db._setResults([]);
			const result = await user.update({ name: 'New Name' });

			// Check that chaining works - result has the same state
			expect(result.id).toBe(user.id);
			expect(result.name).toBe('New Name');
		});
	});

	describe('User.update() static method', () => {
		it('finds and updates the record', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			// After find, need results for update
			const user = await User.update(1, { name: 'New Name' });

			expect(user.name).toBe('New Name');
		});

		it('throws RecordNotFoundError if record does not exist', async () => {
			db._setResults([]);

			await expect(User.update(999, { name: 'New Name' })).rejects.toThrow(RecordNotFoundError);
		});
	});

	// Phase 5: Delete Operations

	describe('destroy() instance method', () => {
		it('deletes the record from database', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await User.find(1);

			await user.destroy();

			expect(db.delete).toHaveBeenCalled();
		});

		it('marks instance as not persisted', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await User.find(1);

			expect(user.isPersisted).toBe(true);

			await user.destroy();

			expect(user.isPersisted).toBe(false);
			expect(user.isNewRecord).toBe(true);
		});

		it('is a no-op for unpersisted records', async () => {
			const user = User.build({ name: 'Duke', email: 'duke@example.com' });

			await user.destroy();

			expect(db.delete).not.toHaveBeenCalled();
		});

		it('preserves attributes after destroy', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await User.find(1);

			await user.destroy();

			expect(user.name).toBe('Duke');
			expect(user.email).toBe('duke@example.com');
		});
	});

	describe('User.destroy() static method', () => {
		it('deletes the record by id', async () => {
			await User.destroy(1);

			expect(db.delete).toHaveBeenCalled();
		});

		it('does not throw if record does not exist', async () => {
			// Static destroy is idempotent - doesn't check existence
			await expect(User.destroy(999)).resolves.toBeUndefined();
		});
	});
});
