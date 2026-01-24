import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { setGlobalConnection } from './connection';

const connectionString =
	process.env.DATABASE_URL ||
	'postgresql://activerecordjs:activerecordjs@localhost:5433/activerecordjs_test';

let client: ReturnType<typeof postgres>;
let db: PostgresJsDatabase;

export async function setupTestDb() {
	client = postgres(connectionString);
	db = drizzle(client);
	setGlobalConnection(db);

	// Create tables (matching fixtures/schema.ts)
	await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

	await db.execute(sql`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT,
      user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

	return db;
}

export async function cleanupTestDb() {
	await db.execute(sql`TRUNCATE TABLE posts, users RESTART IDENTITY CASCADE`);
}

export async function teardownTestDb() {
	await db.execute(sql`DROP TABLE IF EXISTS posts`);
	await db.execute(sql`DROP TABLE IF EXISTS users`);
	await client.end();
}

export { db };
