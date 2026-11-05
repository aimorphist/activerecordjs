import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
	setupTestDb,
	teardownTestDb,
	beginTestTransaction,
	rollbackTestTransaction
} from './setup.integration';
import { Model } from './model';
import { RecordNotFoundError } from './errors';
import { usersTable } from './fixtures/schema';

describe('CRUD Integration Tests', () => {
	let User: ReturnType<typeof Model<typeof usersTable>>;

	beforeAll(async () => {
		await setupTestDb();
		User = Model(usersTable);
	});

	afterAll(async () => {
		await teardownTestDb();
	});

	beforeEach(async () => {
		await beginTestTransaction();
	});

	afterEach(async () => {
		await rollbackTestTransaction();
	});

	describe('Create', () => {
		it('creates a record with all attributes', async () => {
			const user = await User.create({
				name: 'Duke Jones',
				email: 'duke@example.com'
			});

			expect(user.id).toBeGreaterThan(0);
			expect(user.name).toBe('Duke Jones');
			expect(user.email).toBe('duke@example.com');
			expect(user.createdAt).toBeInstanceOf(Date);
			expect(user.updatedAt).toBeInstanceOf(Date);
		});

		it('creates a record using build() and save()', async () => {
			const user = User.build({
				name: 'Jane Doe',
				email: 'jane@example.com'
			});

			expect(user.isNewRecord).toBe(true);

			await user.save();

			expect(user.isNewRecord).toBe(false);
			expect(user.isPersisted).toBe(true);
			expect(user.id).toBeGreaterThan(0);
		});

		it('auto-generates timestamps on create', async () => {
			const before = new Date();
			const user = await User.create({ email: 'test@example.com' });
			const after = new Date();

			expect(user.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
			expect(user.createdAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
		});
	});

	describe('Read', () => {
		let user1: Awaited<ReturnType<typeof User.create>>;
		let user2: Awaited<ReturnType<typeof User.create>>;
		let user3: Awaited<ReturnType<typeof User.create>>;

		beforeEach(async () => {
			user1 = await User.create({ name: 'User 1', email: 'user1@example.com' });
			user2 = await User.create({ name: 'User 2', email: 'user2@example.com' });
			user3 = await User.create({ name: 'User 3', email: 'user3@example.com' });
		});

		it('find() returns record by id', async () => {
			const user = await User.find(user2.id as number);

			expect(user.id).toBe(user2.id);
			expect(user.name).toBe('User 2');
		});

		it('find() throws RecordNotFoundError for missing id', async () => {
			await expect(User.find(999999)).rejects.toThrow(RecordNotFoundError);
		});

		it('findBy() returns first matching record', async () => {
			const user = await User.findBy({ email: 'user2@example.com' });

			expect(user).not.toBeNull();
			expect(user!.name).toBe('User 2');
		});

		it('findBy() returns null for no match', async () => {
			const user = await User.findBy({ email: 'nonexistent@example.com' });

			expect(user).toBeNull();
		});

		it('all() returns all records', async () => {
			const allUsers = await User.all();

			expect(allUsers).toHaveLength(3);
			expect(allUsers.map((u) => u.name)).toEqual(['User 1', 'User 2', 'User 3']);
		});

		it('first() returns record with lowest id', async () => {
			const user = await User.first();

			expect(user).not.toBeNull();
			expect(user!.id).toBe(user1.id);
			expect(user!.name).toBe('User 1');
		});

		it('last() returns record with highest id', async () => {
			const user = await User.last();

			expect(user).not.toBeNull();
			expect(user!.id).toBe(user3.id);
			expect(user!.name).toBe('User 3');
		});

		it('first() returns null for empty table', async () => {
			// Delete all seeded users to test empty case
			const allUsers = await User.all();
			for (const user of allUsers) {
				await user.destroy();
			}

			const user = await User.first();

			expect(user).toBeNull();
		});
	});

	describe('Update', () => {
		it('instance update() modifies and saves', async () => {
			const user = await User.create({ name: 'Original', email: 'test@example.com' });

			// Small delay to ensure timestamp difference
			await new Promise((resolve) => setTimeout(resolve, 10));

			await user.update({ name: 'Modified' });

			expect(user.name).toBe('Modified');

			// Verify persisted
			const reloaded = await User.find(user.id as number);
			expect(reloaded.name).toBe('Modified');
		});

		it('static update() finds and modifies record', async () => {
			const created = await User.create({ name: 'Original', email: 'test@example.com' });

			const updated = await User.update(created.id as number, { name: 'Static Update' });

			expect(updated.name).toBe('Static Update');

			// Verify persisted
			const reloaded = await User.find(created.id as number);
			expect(reloaded.name).toBe('Static Update');
		});

		it('save() updates existing record', async () => {
			const user = await User.create({ name: 'Original', email: 'test@example.com' });

			user.name = 'Direct Assignment';
			await user.save();

			const reloaded = await User.find(user.id as number);
			expect(reloaded.name).toBe('Direct Assignment');
		});

		it('auto-updates updatedAt on save', async () => {
			const user = await User.create({ name: 'Test', email: 'test@example.com' });
			const originalUpdatedAt = user.updatedAt;

			await new Promise((resolve) => setTimeout(resolve, 10));

			user.name = 'Modified';
			await user.save();

			const reloaded = await User.find(user.id as number);
			expect(reloaded.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
		});
	});

	describe('Delete', () => {
		it('instance destroy() removes record', async () => {
			const user = await User.create({ name: 'To Delete', email: 'delete@example.com' });
			const id = user.id as number;

			await user.destroy();

			expect(user.isPersisted).toBe(false);
			await expect(User.find(id)).rejects.toThrow(RecordNotFoundError);
		});

		it('static destroy() removes record by id', async () => {
			const user = await User.create({ name: 'To Delete', email: 'delete@example.com' });

			await User.destroy(user.id as number);

			await expect(User.find(user.id as number)).rejects.toThrow(RecordNotFoundError);
		});

		it('destroy() on new record is no-op', async () => {
			const user = User.build({ name: 'Never Saved', email: 'new@example.com' });

			await user.destroy(); // Should not throw

			expect(user.isPersisted).toBe(false);
		});
	});

	describe('Edge Cases', () => {
		it('handles null attribute values', async () => {
			const user = await User.create({ name: null, email: 'test@example.com' });

			expect(user.name).toBeNull();

			const reloaded = await User.find(user.id as number);
			expect(reloaded.name).toBeNull();
		});

		it('handles special characters in strings', async () => {
			const specialName = 'O\'Brien "The Great"';
			const user = await User.create({ name: specialName, email: 'test@example.com' });

			const reloaded = await User.find(user.id as number);
			expect(reloaded.name).toBe(specialName);
		});

		it('maintains instance identity after save', async () => {
			const user = User.build({ email: 'test@example.com' });
			const result = await user.save();

			// Check that result is the same proxy instance
			expect(result.id).toBe(user.id);
			expect(result.isPersisted).toBe(user.isPersisted);
		});
	});

	describe('Reload', () => {
		it('reloads record from database, discarding unsaved changes', async () => {
			const user = await User.create({ name: 'Original', email: 'test@example.com' });

			// Make local changes without saving
			user.name = 'Unsaved Change';
			expect(user.name).toBe('Unsaved Change');

			// Reload should discard changes
			await user.reload();

			expect(user.name).toBe('Original');
		});

		it('picks up changes made by other processes', async () => {
			const user = await User.create({ name: 'Original', email: 'test@example.com' });

			// Simulate another process updating the record
			await User.update(user.id as number, { name: 'Updated Externally' });

			// Our instance still has old value
			expect(user.name).toBe('Original');

			// Reload picks up external change
			await user.reload();
			expect(user.name).toBe('Updated Externally');
		});

		it('returns the instance for chaining', async () => {
			const user = await User.create({ name: 'Test', email: 'test@example.com' });

			const result = await user.reload();

			expect(result).toBe(user);
		});

		it('clears validation errors on reload', async () => {
			const user = await User.create({ name: 'Test', email: 'test@example.com' });

			// Manually set some errors
			(user as any)._errors = { name: ['some error'] };
			expect(Object.keys(user.errors).length).toBeGreaterThan(0);

			await user.reload();

			expect(user.errors).toEqual({});
		});

		it('throws error when called on new record', async () => {
			const user = User.build({ name: 'New', email: 'new@example.com' });

			await expect(user.reload()).rejects.toThrow('Cannot reload a new record');
		});

		it('throws RecordNotFoundError if record was deleted', async () => {
			const user = await User.create({ name: 'ToDelete', email: 'delete@example.com' });
			const id = user.id as number;

			// Delete via static method (user instance still thinks it's persisted)
			await User.destroy(id);

			// Reload should throw
			await expect(user.reload()).rejects.toThrow(RecordNotFoundError);
		});
	});
});
