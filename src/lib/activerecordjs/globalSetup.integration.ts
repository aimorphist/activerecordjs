/**
 * Vitest global setup - runs once before all test files.
 * Creates test database tables.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

const connectionString =
	process.env.TEST_DATABASE_URL ||
	process.env.DATABASE_URL ||
	'postgresql://localhost:5432/bagpipe_test';

export async function setup() {
	const client = postgres(connectionString);
	const db = drizzle(client);

	// Create tables (DROP first to ensure clean state)
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

	await client.end();
	console.log('Test database tables created');
}

export async function teardown() {
	// Optional: clean up after all tests
	// For now, leave tables for inspection
}
