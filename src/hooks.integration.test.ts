import { describe, expect } from 'vitest';
import { it, useTestScope } from './setup.integration';
import { Model } from './model';
import { usersTable } from './fixtures/schema';

describe('Hooks Integration Tests', () => {
	useTestScope();

	describe('hooks with real database', () => {
		it('beforeSave modifies data that persists to DB', async () => {
			const hookOrder: string[] = [];

			class User extends Model(usersTable) {
				static beforeSave = [
					(user: any) => {
						hookOrder.push('beforeSave');
						// Lowercase the email
						if (user.email) {
							user.email = user.email.toLowerCase();
						}
					}
				];
			}

			const user = await User.create({
				name: 'Duke Jones',
				email: 'DUKE@EXAMPLE.COM'
			});

			// Verify the email was lowercased in memory
			expect(user.email).toBe('duke@example.com');
			expect(hookOrder).toContain('beforeSave');

			// Verify it persisted to the database by reloading
			const reloaded = await User.find(user.id);
			expect(reloaded.email).toBe('duke@example.com');
		});

		it('afterCreate can read the saved record ID', async () => {
			let capturedId: number | null = null;

			class User extends Model(usersTable) {
				static afterCreate = [
					(user: any) => {
						// After INSERT, the ID should be populated
						capturedId = user.id;
					}
				];
			}

			const user = await User.create({
				email: 'test@example.com'
			});

			expect(capturedId).toBe(user.id);
			expect(capturedId).toBeGreaterThan(0);
		});

		it('hook execution order is correct for create', async () => {
			const hookOrder: string[] = [];

			class User extends Model(usersTable) {
				static beforeSave = [
					(user: any) => {
						hookOrder.push('beforeSave');
					}
				];
				static beforeCreate = [
					(user: any) => {
						hookOrder.push('beforeCreate');
					}
				];
				static afterCreate = [
					(user: any) => {
						hookOrder.push('afterCreate');
					}
				];
				static afterSave = [
					(user: any) => {
						hookOrder.push('afterSave');
					}
				];
			}

			await User.create({ email: 'test@example.com' });

			// Verify correct order: beforeSave -> beforeCreate -> INSERT -> afterCreate -> afterSave
			expect(hookOrder).toEqual(['beforeSave', 'beforeCreate', 'afterCreate', 'afterSave']);
		});

		it('hook execution order is correct for update', async () => {
			const hookOrder: string[] = [];

			class User extends Model(usersTable) {
				static beforeSave = [
					(user: any) => {
						hookOrder.push('beforeSave');
					}
				];
				static beforeUpdate = [
					(user: any) => {
						hookOrder.push('beforeUpdate');
					}
				];
				static afterUpdate = [
					(user: any) => {
						hookOrder.push('afterUpdate');
					}
				];
				static afterSave = [
					(user: any) => {
						hookOrder.push('afterSave');
					}
				];
			}

			const user = await User.create({ email: 'test@example.com' });
			hookOrder.length = 0; // Clear create hooks

			await user.update({ name: 'Updated' });

			// Verify correct order: beforeSave -> beforeUpdate -> UPDATE -> afterUpdate -> afterSave
			expect(hookOrder).toEqual(['beforeSave', 'beforeUpdate', 'afterUpdate', 'afterSave']);
		});

		it('beforeDestroy can prevent deletion', async () => {
			class User extends Model(usersTable) {
				static beforeDestroy = [
					(user: any) => {
						throw new Error('Cannot delete this user');
					}
				];
			}

			const user = await User.create({ email: 'test@example.com' });
			const userId = user.id;

			// Attempt to destroy should throw
			await expect(user.destroy()).rejects.toThrow('Cannot delete this user');

			// Verify record still exists by finding it
			const found = await User.find(userId);
			expect(found).toBeTruthy();
			expect(found.id).toBe(userId);
		});

		it('afterDestroy fires after successful deletion', async () => {
			let hookFired = false;

			class User extends Model(usersTable) {
				static afterDestroy = [
					(user: any) => {
						hookFired = true;
					}
				];
			}

			const user = await User.create({ email: 'test@example.com' });
			const userId = user.id;

			await user.destroy();

			expect(hookFired).toBe(true);

			// Verify record is gone by trying to find it
			const found = await User.findBy({ id: userId });
			expect(found).toBeNull();
		});

		it('multiple hooks all execute in order', async () => {
			const modifications: string[] = [];

			class User extends Model(usersTable) {
				static beforeSave = [
					(user: any) => {
						modifications.push('first');
						user.name = (user.name || '') + '-first';
					},
					(user: any) => {
						modifications.push('second');
						user.name = (user.name || '') + '-second';
					},
					(user: any) => {
						modifications.push('third');
						user.name = (user.name || '') + '-third';
					}
				];
			}

			const user = await User.create({
				name: 'base',
				email: 'test@example.com'
			});

			// Verify all hooks ran in order
			expect(modifications).toEqual(['first', 'second', 'third']);
			expect(user.name).toBe('base-first-second-third');

			// Verify modifications persisted by reloading
			const reloaded = await User.find(user.id);
			expect(reloaded.name).toBe('base-first-second-third');
		});

		it('async hooks work with DB operations', async () => {
			// Create a user to reference
			const BaseUser = Model(usersTable);
			const referenceUser = await BaseUser.create({
				name: 'Reference User',
				email: 'reference@example.com'
			});

			class User extends Model(usersTable) {
				static beforeSave = [
					async (user: any) => {
						// Simulate async DB lookup using ORM method
						const found = await BaseUser.find(referenceUser.id);

						if (found) {
							user.name = `Verified: ${user.name}`;
						}
					}
				];
			}

			const user = await User.create({
				name: 'Test',
				email: 'test@example.com'
			});

			// Verify async hook completed and modified data
			expect(user.name).toBe('Verified: Test');

			// Verify it persisted by reloading
			const reloaded = await User.find(user.id);
			expect(reloaded.name).toBe('Verified: Test');
		});

		it('hook can access and modify multiple attributes', async () => {
			class User extends Model(usersTable) {
				static beforeSave = [
					(user: any) => {
						// Normalize email and set default name
						if (user.email) {
							user.email = user.email.trim().toLowerCase();
						}
						if (!user.name) {
							user.name = user.email?.split('@')[0] || 'unknown';
						}
					}
				];
			}

			const user = await User.create({
				email: '  DUKE@EXAMPLE.COM  '
			});

			expect(user.email).toBe('duke@example.com');
			expect(user.name).toBe('duke');

			// Verify both modifications persisted by reloading
			const reloaded = await User.find(user.id);
			expect(reloaded.email).toBe('duke@example.com');
			expect(reloaded.name).toBe('duke');
		});

		it('hook throwing error prevents save and leaves DB unchanged', async () => {
			class User extends Model(usersTable) {
				static beforeSave = [
					(user: any) => {
						if (user.email?.includes('banned')) {
							throw new Error('Email domain is banned');
						}
					}
				];
			}

			// Get initial count
			const beforeUsers = await User.all();
			const beforeCount = beforeUsers.length;

			// Attempt to create with banned email
			await expect(
				User.create({
					email: 'test@banned.com'
				})
			).rejects.toThrow('Email domain is banned');

			// Verify no record was created in DB
			const afterUsers = await User.all();
			expect(afterUsers.length).toBe(beforeCount);
		});

		it('beforeUpdate only fires on update, not create', async () => {
			const createHooks: string[] = [];
			const updateHooks: string[] = [];

			class User extends Model(usersTable) {
				static beforeCreate = [
					(user: any) => {
						createHooks.push('beforeCreate');
					}
				];
				static beforeUpdate = [
					(user: any) => {
						updateHooks.push('beforeUpdate');
					}
				];
			}

			const user = await User.create({ email: 'test@example.com' });

			expect(createHooks).toEqual(['beforeCreate']);
			expect(updateHooks).toEqual([]);

			createHooks.length = 0;
			updateHooks.length = 0;

			await user.update({ name: 'Updated' });

			expect(createHooks).toEqual([]);
			expect(updateHooks).toEqual(['beforeUpdate']);
		});

		it('afterUpdate receives updated record with new values', async () => {
			let capturedName: string | null = null;

			class User extends Model(usersTable) {
				static afterUpdate = [
					(user: any) => {
						capturedName = user.name;
					}
				];
			}

			const user = await User.create({
				name: 'Original',
				email: 'test@example.com'
			});

			await user.update({ name: 'Modified' });

			expect(capturedName).toBe('Modified');
		});

		it('beforeSave hook can modify updatedAt timestamp field', async () => {
			class User extends Model(usersTable) {
				static beforeSave = [
					(user: any) => {
						// Force a specific timestamp
						user.updatedAt = new Date('2025-01-01T00:00:00Z');
					}
				];
			}

			const user = await User.create({
				email: 'test@example.com'
			});

			expect(user.updatedAt.toISOString()).toBe('2025-01-01T00:00:00.000Z');

			// Verify it persisted by reloading
			const reloaded = await User.find(user.id);
			expect(reloaded.updatedAt?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
		});
	});

	describe('hook edge cases', () => {
		it('hooks work with build() and save()', async () => {
			const hookOrder: string[] = [];

			class User extends Model(usersTable) {
				static beforeSave = [
					(user: any) => {
						hookOrder.push('beforeSave');
					}
				];
				static beforeCreate = [
					(user: any) => {
						hookOrder.push('beforeCreate');
					}
				];
			}

			const user = User.build({ email: 'test@example.com' });
			expect(hookOrder).toEqual([]); // No hooks fired yet

			await user.save();
			expect(hookOrder).toEqual(['beforeSave', 'beforeCreate']);
		});

		it('hooks fire on static update()', async () => {
			const hookOrder: string[] = [];

			class User extends Model(usersTable) {
				static beforeUpdate = [
					(user: any) => {
						hookOrder.push('beforeUpdate');
					}
				];
				static afterUpdate = [
					(user: any) => {
						hookOrder.push('afterUpdate');
					}
				];
			}

			const created = await User.create({ email: 'test@example.com' });

			hookOrder.length = 0;

			await User.update(created.id, { name: 'Static Update' });

			expect(hookOrder).toEqual(['beforeUpdate', 'afterUpdate']);
		});

		it('destroy hooks do not fire for new records', async () => {
			let hookFired = false;

			class User extends Model(usersTable) {
				static beforeDestroy = [
					(user: any) => {
						hookFired = true;
					}
				];
			}

			const user = User.build({ email: 'test@example.com' });
			await user.destroy();

			expect(hookFired).toBe(false);
		});

		it('hook can conditionally abort based on record state', async () => {
			let originalEmail: string | null = null;

			class User extends Model(usersTable) {
				static beforeUpdate = [
					(user: any) => {
						// Capture original email in beforeUpdate (before it's changed)
						// In a real scenario, you'd reload from DB or track changes
						if (user.email !== originalEmail && originalEmail !== null) {
							throw new Error('Email cannot be changed');
						}
					}
				];
			}

			const user = await User.create({ email: 'original@example.com' });
			originalEmail = user.email;

			await expect(user.update({ email: 'new@example.com' })).rejects.toThrow(
				'Email cannot be changed'
			);

			// Verify email didn't change in DB by reloading
			const reloaded = await User.find(user.id);
			expect(reloaded.email).toBe('original@example.com');
		});
	});
});
