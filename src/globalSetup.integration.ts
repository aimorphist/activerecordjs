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
	'postgresql://activerecordjs:activerecordjs@localhost:5433/activerecordjs_test';

export async function setup() {
	const client = postgres(connectionString);
	const db = drizzle(client);

	// Create tables (DROP first to ensure clean state)
	// Drop in correct order (dependent tables first)
	await db.execute(sql`DROP TABLE IF EXISTS posts_tags CASCADE`);
	await db.execute(sql`DROP TABLE IF EXISTS tags CASCADE`);
	await db.execute(sql`DROP TABLE IF EXISTS profiles CASCADE`);
	await db.execute(sql`DROP TABLE IF EXISTS comments CASCADE`);
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

	await db.execute(sql`
    CREATE TABLE comments (
      id SERIAL PRIMARY KEY,
      body TEXT NOT NULL,
      post_id INTEGER REFERENCES posts(id),
      user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

	await db.execute(sql`
    CREATE TABLE profiles (
      id SERIAL PRIMARY KEY,
      bio TEXT,
      avatar_url TEXT,
      user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

	await db.execute(sql`
    CREATE TABLE tags (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

	await db.execute(sql`
    CREATE TABLE posts_tags (
      post_id INTEGER REFERENCES posts(id) NOT NULL,
      tag_id INTEGER REFERENCES tags(id) NOT NULL,
      PRIMARY KEY (post_id, tag_id)
    )
  `);

	await client.end();
	console.log('Test database tables created');
}

export async function teardown() {
	// Optional: clean up after all tests
	// For now, leave tables for inspection
}
