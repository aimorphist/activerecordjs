/**
 * postgres-js entry: a scope over a lazy postgres.js pool. No server is
 * contacted; postgres.js connects on first query.
 */
import { describe, it, expect } from 'vitest';
import { createPostgresJsScope } from './postgres-js';
import { ScopeClosedError } from './errors';
import { usersTable } from './fixtures/schema';

describe('createPostgresJsScope', () => {
	it('opens a root scope that binds models and ends its client on close', async () => {
		const scope = createPostgresJsScope('postgres://nobody@127.0.0.1:1/none', { max: 1 });
		expect(scope.lease).toBeNull();
		expect(scope.model(usersTable).connectionScope).toBe(scope);
		expect(typeof scope.session().transaction).toBe('function');

		await scope.close();

		expect(scope.closed).toBe(true);
		expect(() => scope.session()).toThrow(ScopeClosedError);
		await expect(scope.model(usersTable).find(1)).rejects.toBeInstanceOf(ScopeClosedError);
	});
});
