import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Model, type HookFunction } from './model';
import { usersTable } from './fixtures/schema';
import { setGlobalConnection } from './connection';

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

describe('ActiveRecordJS Hooks', () => {
	let db: ReturnType<typeof createMockDb>;

	beforeEach(() => {
		db = createMockDb();
		setGlobalConnection(db as any);
	});

	describe('beforeSave', () => {
		it('fires before create', async () => {
			const beforeSaveSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static beforeSave = [beforeSaveSpy];
			}

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });
			await user.save();

			expect(beforeSaveSpy).toHaveBeenCalledTimes(1);
			expect(beforeSaveSpy).toHaveBeenCalledWith(user);
		});

		it('fires before update', async () => {
			const beforeSaveSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static beforeSave = [beforeSaveSpy];
			}

			// Setup existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await UserWithHook.find(1);

			// Update
			beforeSaveSpy.mockClear();
			db._setResults([]);
			user.name = 'Modified';
			await user.save();

			expect(beforeSaveSpy).toHaveBeenCalledTimes(1);
			expect(beforeSaveSpy).toHaveBeenCalledWith(user);
		});

		it('can modify attributes', async () => {
			class UserWithHook extends Model(usersTable) {
				static beforeSave = [
					(user: any) => {
						user.name = user.name.toUpperCase();
					}
				];
			}

			db._setResults([{ id: 1, name: 'DUKE', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ name: 'duke', email: 'duke@example.com' });
			await user.save();

			expect(user.name).toBe('DUKE');
		});

		it('aborts save when throwing', async () => {
			class UserWithHook extends Model(usersTable) {
				static beforeSave = [
					() => {
						throw new Error('Hook abort');
					}
				];
			}

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });

			await expect(user.save()).rejects.toThrow('Hook abort');
			expect(db.insert).not.toHaveBeenCalled();
		});

		it('runs multiple beforeSave hooks in sequence', async () => {
			const order: number[] = [];

			class UserWithHook extends Model(usersTable) {
				static beforeSave = [
					() => {
						order.push(1);
					},
					() => {
						order.push(2);
					}
				];
			}

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });
			await user.save();

			expect(order).toEqual([1, 2]);
		});
	});

	describe('afterSave', () => {
		it('fires after successful create', async () => {
			const afterSaveSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static afterSave = [afterSaveSpy];
			}

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });
			await user.save();

			expect(afterSaveSpy).toHaveBeenCalledTimes(1);
			expect(afterSaveSpy).toHaveBeenCalledWith(user);
		});

		it('fires after successful update', async () => {
			const afterSaveSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static afterSave = [afterSaveSpy];
			}

			// Setup existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await UserWithHook.find(1);

			// Update
			afterSaveSpy.mockClear();
			db._setResults([]);
			user.name = 'Modified';
			await user.save();

			expect(afterSaveSpy).toHaveBeenCalledTimes(1);
			expect(afterSaveSpy).toHaveBeenCalledWith(user);
		});

		it('does not fire when save fails', async () => {
			const afterSaveSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static beforeSave = [
					() => {
						throw new Error('Save failed');
					}
				];
				static afterSave = [afterSaveSpy];
			}

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });

			await expect(user.save()).rejects.toThrow('Save failed');
			expect(afterSaveSpy).not.toHaveBeenCalled();
		});

		it('runs after database operation completes', async () => {
			const afterSaveSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static afterSave = [afterSaveSpy];
			}

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });
			await user.save();

			// After hook should run after DB insert
			expect(db.insert).toHaveBeenCalled();
			expect(afterSaveSpy).toHaveBeenCalled();
		});
	});

	describe('beforeCreate/afterCreate', () => {
		it('only fires for new records', async () => {
			const beforeCreateSpy = vi.fn();
			const afterCreateSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static beforeCreate = [beforeCreateSpy];
				static afterCreate = [afterCreateSpy];
			}

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });
			expect(user.isNewRecord).toBe(true);

			await user.save();

			expect(beforeCreateSpy).toHaveBeenCalledTimes(1);
			expect(afterCreateSpy).toHaveBeenCalledTimes(1);
		});

		it('does not fire for updates', async () => {
			const beforeCreateSpy = vi.fn();
			const afterCreateSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static beforeCreate = [beforeCreateSpy];
				static afterCreate = [afterCreateSpy];
			}

			// Setup existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await UserWithHook.find(1);

			expect(user.isPersisted).toBe(true);
			expect(user.isNewRecord).toBe(false);

			// Update
			db._setResults([]);
			user.name = 'Modified';
			await user.save();

			expect(beforeCreateSpy).not.toHaveBeenCalled();
			expect(afterCreateSpy).not.toHaveBeenCalled();
		});

		it('can set default values in beforeCreate', async () => {
			class UserWithHook extends Model(usersTable) {
				static beforeCreate = [
					(user: any) => {
						if (!user.name) {
							user.name = 'Default Name';
						}
					}
				];
			}

			db._setResults([{ id: 1, name: 'Default Name', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ email: 'duke@example.com' });
			await user.save();

			expect(user.name).toBe('Default Name');
		});
	});

	describe('beforeUpdate/afterUpdate', () => {
		it('only fires for existing records', async () => {
			const beforeUpdateSpy = vi.fn();
			const afterUpdateSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static beforeUpdate = [beforeUpdateSpy];
				static afterUpdate = [afterUpdateSpy];
			}

			// Setup existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await UserWithHook.find(1);

			expect(user.isPersisted).toBe(true);
			expect(user.isNewRecord).toBe(false);

			// Update
			db._setResults([]);
			user.name = 'Modified';
			await user.save();

			expect(beforeUpdateSpy).toHaveBeenCalledTimes(1);
			expect(afterUpdateSpy).toHaveBeenCalledTimes(1);
		});

		it('does not fire for creates', async () => {
			const beforeUpdateSpy = vi.fn();
			const afterUpdateSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static beforeUpdate = [beforeUpdateSpy];
				static afterUpdate = [afterUpdateSpy];
			}

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });
			await user.save();

			expect(beforeUpdateSpy).not.toHaveBeenCalled();
			expect(afterUpdateSpy).not.toHaveBeenCalled();
		});

		it('can modify attributes before update', async () => {
			class UserWithHook extends Model(usersTable) {
				static beforeUpdate = [
					(user: any) => {
						user.name = `Updated: ${user.name}`;
					}
				];
			}

			// Setup existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await UserWithHook.find(1);

			// Update
			db._setResults([]);
			user.name = 'Modified';
			await user.save();

			expect(user.name).toBe('Updated: Modified');
		});
	});

	describe('beforeDestroy/afterDestroy', () => {
		it('fires in correct order', async () => {
			const order: string[] = [];

			class UserWithHook extends Model(usersTable) {
				static beforeDestroy = [
					() => {
						order.push('beforeDestroy');
					}
				];
				static afterDestroy = [
					() => {
						order.push('afterDestroy');
					}
				];
			}

			// Setup existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await UserWithHook.find(1);

			await user.destroy();

			expect(order).toEqual(['beforeDestroy', 'afterDestroy']);
		});

		it('aborts destroy when beforeDestroy throws', async () => {
			class UserWithHook extends Model(usersTable) {
				static beforeDestroy = [
					() => {
						throw new Error('Cannot destroy');
					}
				];
			}

			// Setup existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await UserWithHook.find(1);

			await expect(user.destroy()).rejects.toThrow('Cannot destroy');
			expect(db.delete).not.toHaveBeenCalled();
		});

		it('afterDestroy runs after database delete', async () => {
			const afterDestroySpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static afterDestroy = [afterDestroySpy];
			}

			// Setup existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await UserWithHook.find(1);

			await user.destroy();

			expect(db.delete).toHaveBeenCalled();
			expect(afterDestroySpy).toHaveBeenCalledTimes(1);
		});

		it('does not fire hooks for unpersisted records', async () => {
			const beforeDestroySpy = vi.fn();
			const afterDestroySpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static beforeDestroy = [beforeDestroySpy];
				static afterDestroy = [afterDestroySpy];
			}

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });
			await user.destroy();

			expect(beforeDestroySpy).not.toHaveBeenCalled();
			expect(afterDestroySpy).not.toHaveBeenCalled();
		});
	});

	describe('hook execution order', () => {
		it('runs hooks in correct order for create', async () => {
			const order: string[] = [];

			class UserWithHook extends Model(usersTable) {
				static beforeSave: HookFunction[] = [
					() => {
						order.push('beforeSave');
					}
				];
				static beforeCreate: HookFunction[] = [
					() => {
						order.push('beforeCreate');
					}
				];
				static afterCreate: HookFunction[] = [
					() => {
						order.push('afterCreate');
					}
				];
				static afterSave: HookFunction[] = [
					() => {
						order.push('afterSave');
					}
				];
			}

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });
			await user.save();

			// Should be: beforeSave -> beforeCreate -> INSERT -> afterCreate -> afterSave
			expect(order).toEqual(['beforeSave', 'beforeCreate', 'afterCreate', 'afterSave']);
		});

		it('runs hooks in correct order for update', async () => {
			const order: string[] = [];

			class UserWithHook extends Model(usersTable) {
				static beforeSave: HookFunction[] = [
					() => {
						order.push('beforeSave');
					}
				];
				static beforeUpdate: HookFunction[] = [
					() => {
						order.push('beforeUpdate');
					}
				];
				static afterUpdate: HookFunction[] = [
					() => {
						order.push('afterUpdate');
					}
				];
				static afterSave: HookFunction[] = [
					() => {
						order.push('afterSave');
					}
				];
			}

			// Setup existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await UserWithHook.find(1);

			// Update
			db._setResults([]);
			user.name = 'Modified';
			await user.save();

			// Should be: beforeSave -> beforeUpdate -> UPDATE -> afterUpdate -> afterSave
			expect(order).toEqual(['beforeSave', 'beforeUpdate', 'afterUpdate', 'afterSave']);
		});

		it('only runs create hooks, not update hooks, for new records', async () => {
			const order: string[] = [];

			class UserWithHook extends Model(usersTable) {
				static beforeSave: HookFunction[] = [
					() => {
						order.push('beforeSave');
					}
				];
				static beforeCreate: HookFunction[] = [
					() => {
						order.push('beforeCreate');
					}
				];
				static beforeUpdate: HookFunction[] = [
					() => {
						order.push('beforeUpdate');
					}
				];
				static afterCreate: HookFunction[] = [
					() => {
						order.push('afterCreate');
					}
				];
				static afterUpdate: HookFunction[] = [
					() => {
						order.push('afterUpdate');
					}
				];
				static afterSave: HookFunction[] = [
					() => {
						order.push('afterSave');
					}
				];
			}

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });
			await user.save();

			expect(order).toEqual(['beforeSave', 'beforeCreate', 'afterCreate', 'afterSave']);
			expect(order).not.toContain('beforeUpdate');
			expect(order).not.toContain('afterUpdate');
		});

		it('only runs update hooks, not create hooks, for existing records', async () => {
			const order: string[] = [];

			class UserWithHook extends Model(usersTable) {
				static beforeSave: HookFunction[] = [
					() => {
						order.push('beforeSave');
					}
				];
				static beforeCreate: HookFunction[] = [
					() => {
						order.push('beforeCreate');
					}
				];
				static beforeUpdate: HookFunction[] = [
					() => {
						order.push('beforeUpdate');
					}
				];
				static afterCreate: HookFunction[] = [
					() => {
						order.push('afterCreate');
					}
				];
				static afterUpdate: HookFunction[] = [
					() => {
						order.push('afterUpdate');
					}
				];
				static afterSave: HookFunction[] = [
					() => {
						order.push('afterSave');
					}
				];
			}

			// Setup existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await UserWithHook.find(1);

			// Update
			db._setResults([]);
			user.name = 'Modified';
			await user.save();

			expect(order).toEqual(['beforeSave', 'beforeUpdate', 'afterUpdate', 'afterSave']);
			expect(order).not.toContain('beforeCreate');
			expect(order).not.toContain('afterCreate');
		});
	});

	describe('async hooks', () => {
		it('awaits async hooks', async () => {
			let resolved = false;

			class UserWithHook extends Model(usersTable) {
				static beforeSave = [
					async () => {
						await new Promise((resolve) => setTimeout(resolve, 10));
						resolved = true;
					}
				];
			}

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });
			await user.save();

			expect(resolved).toBe(true);
		});

		it('runs multiple async hooks in sequence', async () => {
			const order: number[] = [];

			class UserWithHook extends Model(usersTable) {
				static beforeSave = [
					async () => {
						await new Promise((resolve) => setTimeout(resolve, 20));
						order.push(1);
					},
					async () => {
						await new Promise((resolve) => setTimeout(resolve, 10));
						order.push(2);
					}
				];
			}

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });
			await user.save();

			// Should run in sequence, not parallel
			expect(order).toEqual([1, 2]);
		});

		it('handles errors from async hooks', async () => {
			class UserWithHook extends Model(usersTable) {
				static beforeSave = [
					async () => {
						await new Promise((resolve) => setTimeout(resolve, 10));
						throw new Error('Async error');
					}
				];
			}

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });

			await expect(user.save()).rejects.toThrow('Async error');
		});
	});

	describe('hook integration with create()', () => {
		it('fires hooks when using static create method', async () => {
			const beforeCreateSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static beforeCreate = [beforeCreateSpy];
			}

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			await UserWithHook.create({ name: 'Duke', email: 'duke@example.com' });

			expect(beforeCreateSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('hook integration with update() instance method', () => {
		it('fires hooks when using update method', async () => {
			const beforeUpdateSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static beforeUpdate = [beforeUpdateSpy];
			}

			// Setup existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await UserWithHook.find(1);

			// Update
			db._setResults([]);
			await user.update({ name: 'Modified' });

			expect(beforeUpdateSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('models without hooks', () => {
		it('works normally when no hooks defined', async () => {
			const User = Model(usersTable);

			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = User.build({ name: 'Duke', email: 'duke@example.com' });
			await user.save();

			expect(user.id).toBe(1);
			expect(user.isPersisted).toBe(true);
		});
	});

	describe('hook error handling', () => {
		it('preserves original error message from hook', async () => {
			class UserWithHook extends Model(usersTable) {
				static beforeSave = [
					() => {
						throw new Error('Custom hook error message');
					}
				];
			}

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });

			await expect(user.save()).rejects.toThrow('Custom hook error message');
		});

		it('stops at first failing hook', async () => {
			const secondHookSpy = vi.fn();

			class UserWithHook extends Model(usersTable) {
				static beforeSave = [
					() => {
						throw new Error('First hook failed');
					},
					secondHookSpy
				];
			}

			const user = UserWithHook.build({ name: 'Duke', email: 'duke@example.com' });

			await expect(user.save()).rejects.toThrow('First hook failed');
			expect(secondHookSpy).not.toHaveBeenCalled();
		});
	});
});
