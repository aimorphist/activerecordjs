import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
	setupTestDb,
	teardownTestDb,
	beginTestTransaction,
	rollbackTestTransaction
} from './setup.integration';
import { Model } from './model';
import { ValidationError } from './errors';
import { usersTable } from './fixtures/schema';

describe('Validations Integration Tests', () => {
	class User extends Model(usersTable) {
		static validations = {
			email: z.string().email(),
			name: z.string().min(1).optional(),
			$custom: [
				(user: any) => {
					if (user.email?.endsWith('@banned.com')) {
						throw ValidationError.forField('email', 'domain is banned');
					}
				}
			]
		};
	}

	beforeAll(async () => {
		await setupTestDb();
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

	describe('save() with validation', () => {
		it('rejects invalid record on save', async () => {
			const user = User.build({ email: 'invalid' });

			await expect(user.save()).rejects.toThrow(ValidationError);
			expect(user.isPersisted).toBe(false);
		});

		it('saves valid record', async () => {
			const user = User.build({ email: 'valid@example.com' });

			await user.save();

			expect(user.isPersisted).toBe(true);
			expect(user.id).toBeGreaterThan(0);
		});

		it('allows skipping validation with { validate: false }', async () => {
			const user = User.build({ email: 'invalid' });

			await user.save({ validate: false });

			expect(user.isPersisted).toBe(true);
		});

		it('validates on update', async () => {
			const user = await User.create({ email: 'valid@example.com' });

			user.email = 'invalid';

			await expect(user.save()).rejects.toThrow(ValidationError);
		});

		it('runs custom validators on save', async () => {
			const user = User.build({ email: 'test@banned.com' });

			await expect(user.save()).rejects.toThrow(ValidationError);
			expect(user.errors.email).toContain('domain is banned');
		});
	});

	describe('create() with validation', () => {
		it('rejects invalid attributes', async () => {
			await expect(User.create({ email: 'invalid' })).rejects.toThrow(ValidationError);
		});

		it('creates valid record', async () => {
			const user = await User.create({ email: 'valid@example.com' });

			expect(user.isPersisted).toBe(true);
		});

		it('allows skipping validation with { validate: false }', async () => {
			const user = await User.create({ email: 'invalid' }, { validate: false });

			expect(user.isPersisted).toBe(true);
		});
	});

	describe('update() with validation', () => {
		it('validates on instance update', async () => {
			const user = await User.create({ email: 'valid@example.com' });

			await expect(user.update({ email: 'invalid' })).rejects.toThrow(ValidationError);
		});

		it('updates with valid attributes', async () => {
			const user = await User.create({ email: 'valid@example.com' });

			await user.update({ name: 'Duke' });

			expect(user.name).toBe('Duke');
		});
	});

	describe('errors persistence', () => {
		it('errors are accessible after failed save', async () => {
			const user = User.build({ email: 'invalid' });

			try {
				await user.save();
			} catch {
				// expected
			}

			expect(user.errors.email).toBeDefined();
			expect(user.errors.email.length).toBeGreaterThan(0);
		});

		it('errors are cleared on successful save', async () => {
			const user = User.build({ email: 'invalid' });

			try {
				await user.save();
			} catch {
				// expected
			}

			expect(Object.keys(user.errors).length).toBeGreaterThan(0);

			user.email = 'valid@example.com';
			await user.save();

			expect(user.errors).toEqual({});
		});
	});
});
