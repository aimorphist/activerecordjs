/**
 * Script bootstrap module - provides database connection and ActiveRecordJS setup.
 *
 * Usage (simple):
 *   import { db, cleanup } from './lib/bootstrap';
 *   // ... use db and ActiveRecordJS models ...
 *   await cleanup();
 *
 * Usage (with automatic cleanup):
 *   import { runScript } from './lib/bootstrap';
 *   await runScript(async (db) => {
 *     // ... your script logic ...
 *   });
 */

import { config } from 'dotenv';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { setGlobalConnection } from '../../src/lib/activerecordjs';

// Load environment variables from .env file
config();

// Validate DATABASE_URL
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('Error: DATABASE_URL is not set in .env');
	process.exit(1);
}

// Create pooled connection
const client = postgres(DATABASE_URL, {
	max: 10,
	idle_timeout: 30
});

const db = drizzle(client);

// Set up ActiveRecordJS global connection
setGlobalConnection(db);

/**
 * Clean up database connection. Call this before exiting.
 */
async function cleanup(): Promise<void> {
	await client.end();
}

/**
 * Run a script with automatic database setup and cleanup.
 * Handles errors and ensures connection is closed.
 *
 * @example
 * await runScript(async (db) => {
 *   const users = await User.all();
 *   console.log(users);
 * });
 */
async function runScript(fn: (db: PostgresJsDatabase) => Promise<void>): Promise<void> {
	try {
		await fn(db);
	} catch (error: any) {
		console.error('Script error:', error.message);
		if (error.stack) {
			console.error(error.stack);
		}
		process.exitCode = 1;
	} finally {
		await cleanup();
	}
}

export { db, client, cleanup, runScript };
export type { PostgresJsDatabase };
