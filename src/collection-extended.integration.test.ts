import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
	setupTestDb,
	teardownTestDb,
	beginTestTransaction,
	rollbackTestTransaction
} from './setup.integration';
import { User, Post, Comment } from './fixtures/models';

describe('AR6 Phase 6: Extended CollectionProxy Integration Tests', () => {
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

	describe('CollectionProxy.ids()', () => {
		it('returns array of IDs for related records', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			const post1 = await Post.create({ title: 'Post 1', body: 'Body 1', userId: user.id });
			const post2 = await Post.create({ title: 'Post 2', body: 'Body 2', userId: user.id });
			const post3 = await Post.create({ title: 'Post 3', body: 'Body 3', userId: user.id });

			const ids = await user.posts.ids();

			expect(ids).toHaveLength(3);
			expect(ids).toContain(post1.id);
			expect(ids).toContain(post2.id);
			expect(ids).toContain(post3.id);
		});

		it('returns empty array when no related records exist', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });

			const ids = await user.posts.ids();

			expect(ids).toEqual([]);
		});

		it('returns empty array for unsaved owner', async () => {
			const user = User.build({ email: 'test@example.com' });

			const ids = await user.posts.ids();

			expect(ids).toEqual([]);
		});
	});

	describe('CollectionProxy.empty()', () => {
		it('returns true when collection is empty', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });

			const isEmpty = await user.posts.empty();

			expect(isEmpty).toBe(true);
		});

		it('returns false when collection has records', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Post.create({ title: 'Post 1', body: 'Body 1', userId: user.id });

			const isEmpty = await user.posts.empty();

			expect(isEmpty).toBe(false);
		});
	});

	describe('CollectionProxy.size()', () => {
		it('returns count of related records', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Post.create({ title: 'Post 1', body: 'Body 1', userId: user.id });
			await Post.create({ title: 'Post 2', body: 'Body 2', userId: user.id });

			const size = await user.posts.size();

			expect(size).toBe(2);
		});

		it('returns 0 for empty collection', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });

			const size = await user.posts.size();

			expect(size).toBe(0);
		});
	});

	describe('CollectionProxy.includes()', () => {
		it('returns true when record is in collection', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			const post = await Post.create({ title: 'Post 1', body: 'Body 1', userId: user.id });

			const result = await user.posts.includes(post);

			expect(result).toBe(true);
		});

		it('returns false when record is not in collection', async () => {
			const user1 = await User.create({ email: 'test1@example.com', name: 'User 1' });
			const user2 = await User.create({ email: 'test2@example.com', name: 'User 2' });
			const post = await Post.create({ title: 'Post 1', body: 'Body 1', userId: user2.id });

			// Verify the post actually belongs to user2
			expect(post.userId).toBe(user2.id);
			expect(post.userId).not.toBe(user1.id);

			// Direct query to verify the logic
			const directCheck = await Post.where({ userId: user1.id, id: post.id }).exists();
			expect(directCheck).toBe(false);

			const result = await user1.posts.includes(post);

			expect(result).toBe(false);
		});

		it('works with record ID as argument', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			const post = await Post.create({ title: 'Post 1', body: 'Body 1', userId: user.id });

			const result = await user.posts.includes(post.id);

			expect(result).toBe(true);
		});

		it('returns false for unsaved owner', async () => {
			const user = User.build({ email: 'test@example.com' });
			const otherUser = await User.create({ email: 'other@example.com', name: 'Other User' });
			const post = await Post.create({
				title: 'Post 1',
				body: 'Body 1',
				userId: otherUser.id
			});

			const result = await user.posts.includes(post);

			expect(result).toBe(false);
		});
	});

	describe('CollectionProxy.where()', () => {
		it('scopes by association and additional conditions', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Post.create({ title: 'Published Post', body: 'Body 1', userId: user.id });
			await Post.create({ title: 'Draft Post', body: 'Body 2', userId: user.id });

			const posts = await user.posts.where({ title: 'Published Post' }).all();

			expect(posts).toHaveLength(1);
			expect(posts[0].title).toBe('Published Post');
		});

		it('is chainable with other query methods', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Post.create({ title: 'Post 1', body: 'Body 1', userId: user.id });
			await Post.create({ title: 'Post 2', body: 'Body 2', userId: user.id });
			await Post.create({ title: 'Post 3', body: 'Body 3', userId: user.id });

			const posts = await user.posts.where({}).order('title', 'asc').limit(2).all();

			expect(posts).toHaveLength(2);
			expect(posts[0].title).toBe('Post 1');
			expect(posts[1].title).toBe('Post 2');
		});

		it('can count scoped results', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Post.create({ title: 'Published', body: 'Body 1', userId: user.id });
			await Post.create({ title: 'Published', body: 'Body 2', userId: user.id });
			await Post.create({ title: 'Draft', body: 'Body 3', userId: user.id });

			const count = await user.posts.where({ title: 'Published' }).count();

			expect(count).toBe(2);
		});

		it('returns empty array when no records match conditions', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Post.create({ title: 'Post 1', body: 'Body 1', userId: user.id });

			const posts = await user.posts.where({ title: 'Nonexistent' }).all();

			expect(posts).toEqual([]);
		});
	});

	describe('Inverse association setting', () => {
		it('pre-sets belongsTo on create()', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });

			const post = await user.posts.create({ title: 'New Post', body: 'Body' });

			// The inverse association should be pre-cached
			// Access post.user without await to check the cache
			const cachedUser = post._associations.user;
			expect(cachedUser).toBeDefined();
			expect(cachedUser.id).toBe(user.id);
			expect(cachedUser.email).toBe(user.email);
		});

		it('pre-sets belongsTo on build()', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });

			const post = user.posts.build({ title: 'New Post', body: 'Body' });

			// The inverse association should be pre-cached
			const cachedUser = post._associations.user;
			expect(cachedUser).toBeDefined();
			expect(cachedUser.id).toBe(user.id);
			expect(cachedUser.email).toBe(user.email);
		});

		it('works with nested associations', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			const post = await user.posts.create({ title: 'Post', body: 'Body' });

			const comment = await post.comments.create({ body: 'Comment body', userId: user.id });

			// Comment should have cached post association
			const cachedPost = comment._associations.post;
			expect(cachedPost).toBeDefined();
			expect(cachedPost.id).toBe(post.id);
			expect(cachedPost.title).toBe('Post');
		});
	});
});
