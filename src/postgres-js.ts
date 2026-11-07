/**
 * postgres-js entry: the postgres.js driver and a scope over its pool.
 * Does not load the node entry.
 */
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { createScope } from './scope';
import type { ConnectionScope } from './session';

export type { PostgresJsDatabase };

/** Creates a new Drizzle connection from a connection string. */
export function createConnection(connectionString: string): PostgresJsDatabase {
	const client = postgres(connectionString);
	return drizzle(client);
}

/** Creates a pooled connection with configurable options. */
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

/**
 * Open a root scope over a postgres.js pool. The scope owns the client:
 * `close()` rolls back an open transaction, then ends the pool.
 * `transaction` begins a driver transaction on one pooled connection.
 */
export function createPostgresJsScope(
	connectionString: string,
	options: { max?: number; idleTimeout?: number } = {}
): ConnectionScope {
	const { client, db } = createPooledConnection(connectionString, options);
	return createScope(db, { close: () => client.end() });
}

/** Wrap an existing postgres.js client. close() ends it. */
export function scopeFromPostgresClient(client: ReturnType<typeof postgres>): ConnectionScope {
	return createScope(drizzle(client), { close: () => client.end() });
}
