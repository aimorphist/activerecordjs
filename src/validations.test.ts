import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { Model } from './model';
import { ValidationError } from './errors';
import { setGlobalConnection } from './connection';
import { usersTable } from './fixtures/schema';

// Mock database (validations don't need real DB)
function createMockDb() {
	return {
		select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
		insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
		update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
		delete: () => ({ where: () => Promise.resolve() })
	};
}

describe('Validations', () => {
	beforeEach(() => {
		setGlobalConnection(createMockDb() as any);
	});

	describe('Zod field validators', () => {
		it('validates email format', () => {
			class User extends Model(usersTable) {
				static validations = {
					email: z.string().email()
				};
			}

			const user = User.build({ email: 'invalid' });

			expect(user.isValid()).toBe(false);
			expect(user.errors.email).toBeDefined();
			expect(user.errors.email[0]).toContain('email');
		});

		it('passes valid email', () => {
			class User extends Model(usersTable) {
				static validations = {
					email: z.string().email()
				};
			}

			const user = User.build({ email: 'valid@example.com' });

			expect(user.isValid()).toBe(true);
			expect(user.errors).toEqual({});
		});

		it('validates multiple fields', () => {
			class User extends Model(usersTable) {
				static validations = {
					email: z.string().email(),
					name: z.string().min(1)
				};
			}

			const user = User.build({ email: 'invalid', name: '' });

			expect(user.isValid()).toBe(false);
			expect(user.errors.email).toBeDefined();
			expect(user.errors.name).toBeDefined();
		});

		it('handles optional fields', () => {
			class User extends Model(usersTable) {
				static validations = {
					name: z.string().min(1).optional()
				};
			}

			const user = User.build({ email: 'test@example.com' });

			expect(user.isValid()).toBe(true);
		});

		it('handles nullable fields', () => {
			class User extends Model(usersTable) {
				static validations = {
					name: z.string().min(1).nullable()
				};
			}

			const user = User.build({ name: null });

			expect(user.isValid()).toBe(true);
		});
	});

	describe('Custom validators ($custom)', () => {
		it('runs custom validator', () => {
			class User extends Model(usersTable) {
				static validations = {
					$custom: [
						(user: any) => {
							if (user.email?.endsWith('@banned.com')) {
								throw ValidationError.forField('email', 'domain is banned');
							}
						}
					]
				};
			}

			const user = User.build({ email: 'test@banned.com' });

			expect(user.isValid()).toBe(false);
			expect(user.errors.email).toContain('domain is banned');
		});

		it('runs multiple custom validators', () => {
			class User extends Model(usersTable) {
				static validations = {
					$custom: [
						(user: any) => {
							if (!user.name) {
								throw ValidationError.forField('name', 'is required');
							}
						},
						(user: any) => {
							if (user.name && user.name.length > 100) {
								throw ValidationError.forField('name', 'is too long');
							}
						}
					]
				};
			}

			const user = User.build({ email: 'test@example.com' });

			expect(user.isValid()).toBe(false);
			expect(user.errors.name).toContain('is required');
		});

		it('combines Zod and custom validators', () => {
			class User extends Model(usersTable) {
				static validations = {
					email: z.string().email(),
					$custom: [
						(user: any) => {
							if (user.email?.endsWith('@banned.com')) {
								throw ValidationError.forField('email', 'domain is banned');
							}
						}
					]
				};
			}

			// Invalid format
			let user = User.build({ email: 'invalid' });
			expect(user.isValid()).toBe(false);
			expect(user.errors.email).toBeDefined();

			// Banned domain (format is valid)
			user = User.build({ email: 'test@banned.com' });
			expect(user.isValid()).toBe(false);
			expect(user.errors.email).toContain('domain is banned');
		});
	});

	describe('validate() method', () => {
		it('throws ValidationError on invalid', () => {
			class User extends Model(usersTable) {
				static validations = {
					email: z.string().email()
				};
			}

			const user = User.build({ email: 'invalid' });

			expect(() => user.validate()).toThrow(ValidationError);
		});

		it('returns void on valid', () => {
			class User extends Model(usersTable) {
				static validations = {
					email: z.string().email()
				};
			}

			const user = User.build({ email: 'valid@example.com' });

			expect(() => user.validate()).not.toThrow();
		});

		it('populates errors property', () => {
			class User extends Model(usersTable) {
				static validations = {
					email: z.string().email()
				};
			}

			const user = User.build({ email: 'invalid' });

			try {
				user.validate();
			} catch {
				// expected
			}

			expect(user.errors.email).toBeDefined();
		});
	});

	describe('isValid() method', () => {
		it('returns false for invalid record', () => {
			class User extends Model(usersTable) {
				static validations = {
					email: z.string().email()
				};
			}

			const user = User.build({ email: 'invalid' });

			expect(user.isValid()).toBe(false);
		});

		it('returns true for valid record', () => {
			class User extends Model(usersTable) {
				static validations = {
					email: z.string().email()
				};
			}

			const user = User.build({ email: 'valid@example.com' });

			expect(user.isValid()).toBe(true);
		});

		it('clears previous errors before re-validating', () => {
			class User extends Model(usersTable) {
				static validations = {
					email: z.string().email()
				};
			}

			const user = User.build({ email: 'invalid' });
			user.isValid(); // false, populates errors

			user.email = 'valid@example.com';
			user.isValid(); // true, should clear errors

			expect(user.errors).toEqual({});
		});
	});

	describe('Model without validations', () => {
		it('isValid returns true when no validations defined', () => {
			const User = Model(usersTable);
			const user = User.build({ email: 'anything' });

			expect(user.isValid()).toBe(true);
		});

		it('validate does not throw when no validations defined', () => {
			const User = Model(usersTable);
			const user = User.build({ email: 'anything' });

			expect(() => user.validate()).not.toThrow();
		});
	});
});
