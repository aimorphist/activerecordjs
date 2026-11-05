import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
	setupTestDb,
	teardownTestDb,
	beginTestTransaction,
	rollbackTestTransaction
} from './setup.integration';
import { User, Post, Comment, Profile, Tag } from './fixtures/models';
import { getGlobalConnection } from './connection';
import { sql } from 'drizzle-orm';

describe('AR6 Phase 3: HABTM Integration Tests', () => {
	beforeAll(async () => {
		await setupTestDb();
	});

	afterAll(async () => {
		await teardownTestDb();
	});

	beforeEach(async () => {
		await beginTestTransaction();
	});

	afterEach(async () => {
		await rollbackTestTransaction();
	});

	describe('HABTM basics', () => {
		it('loads related records via HABTM', async () => {
			const post = await Post.create({ title: 'Test Post' });
			const tag1 = await Tag.create({ name: 'JavaScript' });
			const tag2 = await Tag.create({ name: 'TypeScript' });

			// Manually insert join records
			const db = getGlobalConnection();
			await db.execute(
				sql`INSERT INTO posts_tags (post_id, tag_id) VALUES (${post.id}, ${tag1.id})`
			);
			await db.execute(
				sql`INSERT INTO posts_tags (post_id, tag_id) VALUES (${post.id}, ${tag2.id})`
			);

			const tags = await post.tags;

			expect(tags).toHaveLength(2);
			const names = tags.map((t: any) => t.name);
			expect(names).toContain('JavaScript');
			expect(names).toContain('TypeScript');
		});

		it('returns empty array when no associations', async () => {
			const post = await Post.create({ title: 'Test Post' });

			const tags = await post.tags;

			expect(tags).toHaveLength(0);
		});
	});

	describe('add() and remove()', () => {
		it('add() creates join table entry', async () => {
			const post = await Post.create({ title: 'Test Post' });
			const tag = await Tag.create({ name: 'JavaScript' });

			await post.tags.add(tag);

			const tags = await post.tags;
			expect(tags).toHaveLength(1);
			expect(tags[0].name).toBe('JavaScript');
		});

		it('add() is idempotent (ON CONFLICT DO NOTHING)', async () => {
			const post = await Post.create({ title: 'Test Post' });
			const tag = await Tag.create({ name: 'JavaScript' });

			await post.tags.add(tag);
			await post.tags.add(tag); // Should not throw

			const tags = await post.tags;
			expect(tags).toHaveLength(1);
		});

		it('remove() deletes join table entry', async () => {
			const post = await Post.create({ title: 'Test Post' });
			const tag = await Tag.create({ name: 'JavaScript' });

			await post.tags.add(tag);
			expect(await post.tags).toHaveLength(1);

			await post.tags.remove(tag);
			const tags = await post.tags;
			expect(tags).toHaveLength(0);
		});

		it('remove() is safe for non-existent', async () => {
			const post = await Post.create({ title: 'Test Post' });
			const tag = await Tag.create({ name: 'JavaScript' });

			// Should not throw
			await post.tags.remove(tag);
		});

		it('add/remove invalidates cache', async () => {
			const post = await Post.create({ title: 'Test Post' });
			const tag = await Tag.create({ name: 'JavaScript' });

			// Load initially (caches empty)
			const initialTags = await post.tags;
			expect(initialTags).toHaveLength(0);

			// Add - should invalidate cache
			await post.tags.add(tag);
			const afterAdd = await post.tags;
			expect(afterAdd).toHaveLength(1);

			// Remove - should invalidate cache
			await post.tags.remove(tag);
			const afterRemove = await post.tags;
			expect(afterRemove).toHaveLength(0);
		});
	});

	describe('count(), ids(), empty(), includes()', () => {
		it('count() counts via join table', async () => {
			const post = await Post.create({ title: 'Test Post' });
			const tag1 = await Tag.create({ name: 'JS' });
			const tag2 = await Tag.create({ name: 'TS' });

			await post.tags.add(tag1);
			await post.tags.add(tag2);

			const count = await post.tags.count();
			expect(count).toBe(2);
		});

		it('ids() returns target IDs', async () => {
			const post = await Post.create({ title: 'Test Post' });
			const tag1 = await Tag.create({ name: 'JS' });
			const tag2 = await Tag.create({ name: 'TS' });

			await post.tags.add(tag1);
			await post.tags.add(tag2);

			const ids = await post.tags.ids();
			expect(ids).toHaveLength(2);
			expect(ids).toContain(tag1.id);
			expect(ids).toContain(tag2.id);
		});

		it('empty() returns boolean', async () => {
			const post = await Post.create({ title: 'Test Post' });
			const tag = await Tag.create({ name: 'JS' });

			expect(await post.tags.empty()).toBe(true);

			await post.tags.add(tag);
			expect(await post.tags.empty()).toBe(false);
		});

		it('includes(record) checks membership', async () => {
			const post = await Post.create({ title: 'Test Post' });
			const tag1 = await Tag.create({ name: 'JS' });
			const tag2 = await Tag.create({ name: 'TS' });

			await post.tags.add(tag1);

			expect(await post.tags.includes(tag1)).toBe(true);
			expect(await post.tags.includes(tag2)).toBe(false);
		});
	});

	describe('join table name inference', () => {
		it('infers join table from sorted table names', async () => {
			// Post (posts) + Tag (tags) -> posts_tags (alphabetically sorted)
			// This is tested implicitly by all the above tests working correctly
			const post = await Post.create({ title: 'Test Post' });
			const tag = await Tag.create({ name: 'JS' });

			await post.tags.add(tag);
			const tags = await post.tags;
			expect(tags).toHaveLength(1);
		});
	});

	describe('eager loading with HABTM', () => {
		it('Post.includes("tags") batch-loads tags', async () => {
			const post1 = await Post.create({ title: 'Post 1' });
			const post2 = await Post.create({ title: 'Post 2' });
			const tag1 = await Tag.create({ name: 'JS' });
			const tag2 = await Tag.create({ name: 'TS' });
			const tag3 = await Tag.create({ name: 'Python' });

			await post1.tags.add(tag1);
			await post1.tags.add(tag2);
			await post2.tags.add(tag2);
			await post2.tags.add(tag3);

			const posts = await Post.includes('tags').all();

			expect(posts).toHaveLength(2);
			const p1 = posts.find((p: any) => p.title === 'Post 1');
			const p2 = posts.find((p: any) => p.title === 'Post 2');

			expect(p1).toBeDefined();
			expect(p2).toBeDefined();
			expect(p1._associations.tags).toHaveLength(2);
			expect(p2._associations.tags).toHaveLength(2);
		});
	});
});
