import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { setGlobalConnection } from './connection';

const connectionString =
	process.env.TEST_DATABASE_URL ||
	process.env.DATABASE_URL ||
	'postgresql://localhost:5432/bagpipe_test';

let client: ReturnType<typeof postgres>;
let db: PostgresJsDatabase;

export async function setupTestDb() {
	client = postgres(connectionString);
	db = drizzle(client);
	setGlobalConnection(db);

	await createTables();

	return db;
}

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
