import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { setGlobalConnection } from './connection';

const connectionString =
	process.env.TEST_DATABASE_URL ||
	process.env.DATABASE_URL ||
	'postgresql://localhost:5432/bagpipe_test';

// Per-test-file connection (max: 1 ensures all queries use same connection for transactions)
let client: ReturnType<typeof postgres>;
let db: PostgresJsDatabase;

/**
 * Sets up the test database for a test file.
 * Creates a dedicated single-connection pool for transaction isolation.
 * Call this in beforeAll().
 */
export async function setupTestDb() {
	// max: 1 ensures all queries go through the same connection,
	// allowing BEGIN/ROLLBACK to work correctly
	client = postgres(connectionString, { max: 1 });
	db = drizzle(client);
	setGlobalConnection(db);

	await createTables();

	return db;
}

/**
 * Begins a test transaction. Call this in beforeEach().
 * All database operations until rollbackTestTransaction() will be within this transaction.
 */
export async function beginTestTransaction() {
	await db.execute(sql`BEGIN`);
}

/**
 * Rolls back the test transaction. Call this in afterEach().
 * Undoes all database changes made during the test.
 */
export async function rollbackTestTransaction() {
	await db.execute(sql`ROLLBACK`);
}

/**
 * @deprecated Use beginTestTransaction/rollbackTestTransaction instead for faster test isolation.
 * Legacy cleanup using TRUNCATE - slower but still available for backwards compatibility.
 */
export async function cleanupTestDb() {
	try {
		await db.execute(sql`TRUNCATE TABLE posts, users RESTART IDENTITY CASCADE`);
	} catch {
		// Tables might not exist if another test suite dropped them, recreate
		await createTables();
	}
}

async function createTables() {
	await db.execute(sql`DROP TABLE IF EXISTS posts CASCADE`);
	await db.execute(sql`DROP TABLE IF EXISTS users CASCADE`);

	await db.execute(sql`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

	await db.execute(sql`
    CREATE TABLE posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT,
      user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

export async function teardownTestDb() {
	await db.execute(sql`DROP TABLE IF EXISTS posts CASCADE`);
	await db.execute(sql`DROP TABLE IF EXISTS users CASCADE`);
	await client.end();
}

export { db };
