import postgres from 'postgres';
import { test as vitestTest, aroundEach } from 'vitest';
import { runWithConnection } from './node';
import type { ConnectionScope } from './session';
import { scopeFromPostgresClient } from './postgres-js';

const connectionString =
	process.env.TEST_DATABASE_URL ||
	process.env.DATABASE_URL ||
	'postgresql://activerecordjs:activerecordjs@localhost:5433/activerecordjs_test';

/** Thrown inside the test transaction to force a rollback. Never escapes the fixture. */
class RollbackTestTransaction extends Error {}

/**
 * Opens a root scope on its own single postgres.js connection, enters its
 * transaction, and hands the callback scope to `provide`. The transaction is
 * rolled back, and the connection released, when `provide` returns.
 */
async function withTestScope(provide: (scope: ConnectionScope) => Promise<void>): Promise<void> {
	const root = scopeFromPostgresClient(postgres(connectionString, { max: 1 }));
	try {
		await root
			.transaction(async (scope) => {
				await provide(scope);
				throw new RollbackTestTransaction();
			})
			.catch((error) => {
				if (!(error instanceof RollbackTestTransaction)) throw error;
			});
	} finally {
		await root.close();
	}
}

/**
 * Vitest's `it` extended with a `scope` fixture: one reserved connection and
 * one open transaction per test, rolled back when the test ends (a throw from
 * the test is still a rollback). Parallel files and tests each hold their own
 * connection. This harness never calls setGlobalConnection.
 */
export const test = vitestTest.extend<{ scope: ConnectionScope }>({
	scope: async ({}, use) => {
		await withTestScope(use);
	}
});

export const it = test;

/**
 * Installs the test's scope as the ambient connection for the test body and its
 * beforeEach/afterEach hooks. A fixture alone cannot do this: the store set
 * around `use()` does not reach the test function, and `aroundEach` does.
 * Call once at the top of a suite (or file) that uses the harness `it`.
 */
export function useTestScope(): void {
	aroundEach<{ scope: ConnectionScope }>(async (runTest, { scope }) => {
		await runWithConnection(scope, runTest);
	});
}
