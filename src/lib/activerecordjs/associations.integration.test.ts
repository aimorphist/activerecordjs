import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { createConnection, setGlobalConnection } from './connection';
import { User, Post, Comment } from './fixtures/models';
import { usersTable, postsTable, commentsTable } from './fixtures/schema';
import { sql } from 'drizzle-orm';

describe('AR5: Associations Integration Tests', () => {
	let db: ReturnType<typeof createConnection>;

	beforeAll(async () => {
		db = createConnection(process.env.DATABASE_URL!);
		setGlobalConnection(db);
	});

	afterAll(async () => {
		await db.execute(sql`DROP TABLE IF EXISTS comments CASCADE`);
		await db.execute(sql`DROP TABLE IF EXISTS posts CASCADE`);
		await db.execute(sql`DROP TABLE IF EXISTS users CASCADE`);
	});

	beforeEach(async () => {
		// Clean up and recreate tables
		await db.execute(sql`DROP TABLE IF EXISTS comments CASCADE`);
		await db.execute(sql`DROP TABLE IF EXISTS posts CASCADE`);
		await db.execute(sql`DROP TABLE IF EXISTS users CASCADE`);

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

		await db.execute(sql`
			CREATE TABLE IF NOT EXISTS comments (
				id SERIAL PRIMARY KEY,
				body TEXT NOT NULL,
				post_id INTEGER REFERENCES posts(id),
				user_id INTEGER REFERENCES users(id),
				created_at TIMESTAMP DEFAULT NOW(),
				updated_at TIMESTAMP DEFAULT NOW()
			)
		`);
	});

	describe('belongsTo', () => {
		it('loads related record via belongsTo', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			const post = await Post.create({ title: 'Test Post', userId: user.id });

			const loadedUser = await post.user;

			expect(loadedUser).not.toBeNull();
			expect(loadedUser.id).toBe(user.id);
			expect(loadedUser.email).toBe('test@example.com');
		});

		it('returns null for null foreign key', async () => {
			const post = await Post.create({ title: 'Orphan Post' });

			const loadedUser = await post.user;

			expect(loadedUser).toBeNull();
		});

		it('caches the loaded association', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			const post = await Post.create({ title: 'Test Post', userId: user.id });

			// First load
			const firstLoad = await post.user;
			// Second load (should be cached)
			const secondLoad = await post.user;

			expect(firstLoad.id).toBe(secondLoad.id);
		});

		it('clears cache on reload()', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			const post = await Post.create({ title: 'Test Post', userId: user.id });

			// Load association
			await post.user;

			// Update user name directly in database
			await User.update(user.id, { name: 'Updated Name' });

			// Should still have old name in cache
			const cachedUser = await post.user;
			expect(cachedUser.name).toBe('Test User');

			// After reload, should get fresh data
			await post.reload();
			const freshUser = await post.user;
			expect(freshUser.name).toBe('Updated Name');
		});
	});

	describe('hasMany', () => {
		it('loads related records via hasMany', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Post.create({ title: 'Post 1', userId: user.id });
			await Post.create({ title: 'Post 2', userId: user.id });

			const posts = await user.posts;

			expect(posts).toHaveLength(2);
			expect(posts.map((p: any) => p.title)).toContain('Post 1');
			expect(posts.map((p: any) => p.title)).toContain('Post 2');
		});

		it('returns empty array for no matches', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });

			const posts = await user.posts;

			expect(posts).toHaveLength(0);
		});

		it('returns empty array for unsaved owner', async () => {
			const user = User.build({ email: 'test@example.com' });

			const posts = await user.posts;

			expect(posts).toHaveLength(0);
		});

		it('caches the loaded association', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Post.create({ title: 'Post 1', userId: user.id });

			// First load
			const firstLoad = await user.posts;
			// Second load (should be cached)
			const secondLoad = await user.posts;

			expect(firstLoad.length).toBe(secondLoad.length);
		});
	});

	describe('CollectionProxy', () => {
		it('count() returns correct count without loading all records', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Post.create({ title: 'Post 1', userId: user.id });
			await Post.create({ title: 'Post 2', userId: user.id });
			await Post.create({ title: 'Post 3', userId: user.id });

			const count = await user.posts.count();

			expect(count).toBe(3);
		});

		it('build() returns unsaved record with FK set', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });

			const post = user.posts.build({ title: 'Draft Post' });

			expect(post.userId).toBe(user.id);
			expect(post.title).toBe('Draft Post');
			expect(post.isNewRecord).toBe(true);
		});

		it('create() saves record with FK set', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });

			const post = await user.posts.create({ title: 'New Post' });

			expect(post.userId).toBe(user.id);
			expect(post.isPersisted).toBe(true);
			expect(post.id).not.toBeNull();
		});

		it('create() invalidates cache', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Post.create({ title: 'Existing Post', userId: user.id });

			// Load posts to cache them
			const initialPosts = await user.posts;
			expect(initialPosts).toHaveLength(1);

			// Create a new post via the proxy
			await user.posts.create({ title: 'New Post' });

			// Cache should be invalidated, so we get fresh data
			const updatedPosts = await user.posts;
			expect(updatedPosts).toHaveLength(2);
		});
	});
});
