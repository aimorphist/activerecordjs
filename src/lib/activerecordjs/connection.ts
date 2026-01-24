import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

// Global fallback connection (used when not in an async context)
let globalDb: PostgresJsDatabase | null = null;

// AsyncLocalStorage for per-context connections (enables parallel test execution)
const connectionContext = new AsyncLocalStorage<PostgresJsDatabase>();

/**
 * Sets the global fallback connection.
 * Used for initial setup and as fallback when not in a specific context.
 */
export function setGlobalConnection(db: PostgresJsDatabase): void {
	globalDb = db;
}

/**
 * Gets the current connection - either from async context or global fallback.
 * This is the main entry point used by Model operations.
 */
export function getGlobalConnection(): PostgresJsDatabase {
	// First check async context (for parallel tests/requests)
	const contextDb = connectionContext.getStore();
	if (contextDb) {
		return contextDb;
	}

	// Fall back to global connection
	if (!globalDb) {
		throw new Error(
			'No database connection. Call createActiveRecordJS(db) first or pass connection to Model().'
		);
	}
	return globalDb;
}

/**
 * Runs a callback with a specific connection bound to the async context.
 * All database operations within the callback will use this connection.
 *
 * @example
 * ```typescript
 * await runWithConnection(testDb, async () => {
 *   await User.create({ name: 'Test' }); // Uses testDb
 * });
 * ```
 */
export function runWithConnection<T>(db: PostgresJsDatabase, fn: () => T): T {
	return connectionContext.run(db, fn);
}

/**
 * Creates a new Drizzle connection from a connection string.
 */
export function createConnection(connectionString: string): PostgresJsDatabase {
	const client = postgres(connectionString);
	return drizzle(client);
}

/**
 * Creates a pooled connection with configurable options.
 */
export function createPooledConnection(
	connectionString: string,
	options: { max?: number; idleTimeout?: number } = {}
): { client: ReturnType<typeof postgres>; db: PostgresJsDatabase } {
	const client = postgres(connectionString, {
		max: options.max ?? 10,
		idle_timeout: options.idleTimeout ?? 30
	});
	const db = drizzle(client);
	return { client, db };
}
