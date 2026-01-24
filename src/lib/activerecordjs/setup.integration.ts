import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { setGlobalConnection, runWithConnection } from './connection';

const connectionString =
	process.env.TEST_DATABASE_URL ||
	process.env.DATABASE_URL ||
	'postgresql://localhost:5432/bagpipe_test';

// Shared connection pool (each Vitest worker gets its own instance)
let pool: ReturnType<typeof postgres> | null = null;
let poolDb: PostgresJsDatabase | null = null;

// Per-test reserved connection (for transaction isolation)
let reservedConnection: ReturnType<typeof postgres> | null = null;
let testDb: PostgresJsDatabase | null = null;

/**
 * Sets up the test database connection for a test file.
 * Tables are created by globalSetup.integration.ts before any tests run.
 * Call this in beforeAll().
 */
export async function setupTestDb() {
	// Create shared pool if not exists (each worker gets its own)
	if (!pool) {
		pool = postgres(connectionString, {
			max: 10, // Pool size for parallel tests
			idle_timeout: 30
		});
		poolDb = drizzle(pool);
	}

	// Set global connection
	setGlobalConnection(poolDb!);
	return poolDb!;
}

/**
 * Begins a test transaction. Call this in beforeEach().
 * Reserves a dedicated connection from the pool and starts a transaction.
 */
export async function beginTestTransaction() {
	// Create a single-connection "pool" for this test to ensure transaction isolation
	// This reserves a connection that won't be shared with other tests
	reservedConnection = postgres(connectionString, { max: 1 });
	testDb = drizzle(reservedConnection);

	// Use runWithConnection so all ORM operations in this async context use testDb
	// Note: We need to set it globally too for the current synchronous context
	setGlobalConnection(testDb);

	await testDb.execute(sql`BEGIN`);
}

/**
 * Rolls back the test transaction. Call this in afterEach().
 * Undoes all database changes and releases the connection.
 */
export async function rollbackTestTransaction() {
	if (testDb) {
		await testDb.execute(sql`ROLLBACK`);
	}
	if (reservedConnection) {
		await reservedConnection.end();
		reservedConnection = null;
		testDb = null;
	}
	// Restore pool connection as global
	if (poolDb) {
		setGlobalConnection(poolDb);
	}
}

/**
 * @deprecated Use beginTestTransaction/rollbackTestTransaction instead.
 */
export async function cleanupTestDb() {
	const db = testDb || poolDb;
	if (!db) return;
	await db.execute(sql`TRUNCATE TABLE posts, users RESTART IDENTITY CASCADE`);
}

export async function teardownTestDb() {
	// Clean up this file's test connection if any
	if (reservedConnection) {
		await reservedConnection.end();
		reservedConnection = null;
		testDb = null;
	}
	// Note: Don't close the shared pool - other test files may still use it
	// Vitest will handle process cleanup
}

/** Export for backward compatibility */
export { runWithConnection };
