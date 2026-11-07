import { describe, expect } from 'vitest';
import { it, useTestScope } from './setup.integration';
import { User, Post, Comment, Profile } from './fixtures/models';

describe('AR6 Phase 4: hasMany :through Integration Tests', () => {
	useTestScope();

	describe('hasMany :through', () => {
		it('loads records through intermediary', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test' });
			const post1 = await Post.create({ title: 'Post 1', userId: user.id });
			const post2 = await Post.create({ title: 'Post 2', userId: user.id });
			await Comment.create({ body: 'Comment 1', postId: post1.id });
			await Comment.create({ body: 'Comment 2', postId: post1.id });
			await Comment.create({ body: 'Comment 3', postId: post2.id });

			const comments = await user.comments;

			expect(comments).toHaveLength(3);
			const bodies = comments.map((c: any) => c.body);
			expect(bodies).toContain('Comment 1');
			expect(bodies).toContain('Comment 2');
			expect(bodies).toContain('Comment 3');
		});

		it('returns empty when no intermediaries', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test' });

			const comments = await user.comments;

			expect(comments).toHaveLength(0);
		});

		it('returns empty when intermediaries have no targets', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test' });
			await Post.create({ title: 'Post 1', userId: user.id });

			const comments = await user.comments;

			expect(comments).toHaveLength(0);
		});

		it('count works through intermediary', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test' });
			const post = await Post.create({ title: 'Post 1', userId: user.id });
			await Comment.create({ body: 'Comment 1', postId: post.id });
			await Comment.create({ body: 'Comment 2', postId: post.id });

			const count = await user.comments.count();

			expect(count).toBe(2);
		});

		it('through + direct hasMany coexist', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test' });
			const post = await Post.create({ title: 'Post 1', userId: user.id });
			await Comment.create({ body: 'Comment 1', postId: post.id });

			// Direct hasMany
			const posts = await user.posts;
			expect(posts).toHaveLength(1);

			// Through hasMany
			const comments = await user.comments;
			expect(comments).toHaveLength(1);
		});

		it('caches the loaded through association', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test' });
			const post = await Post.create({ title: 'Post 1', userId: user.id });
			await Comment.create({ body: 'Comment 1', postId: post.id });

			// First load
			const first = await user.comments;
			// Second load (should be cached)
			const second = await user.comments;

			expect(first.length).toBe(second.length);
		});
	});

	describe('eager loading with through', () => {
		it('User.includes("comments") batch-loads through posts', async () => {
			const user1 = await User.create({ email: 'a@example.com', name: 'A' });
			const user2 = await User.create({ email: 'b@example.com', name: 'B' });
			const post1 = await Post.create({ title: 'Post 1', userId: user1.id });
			const post2 = await Post.create({ title: 'Post 2', userId: user2.id });
			await Comment.create({ body: 'C1', postId: post1.id });
			await Comment.create({ body: 'C2', postId: post1.id });
			await Comment.create({ body: 'C3', postId: post2.id });

			const users = await User.includes('comments').all();

			expect(users).toHaveLength(2);
			const userA = users.find((u: any) => u.name === 'A');
			const userB = users.find((u: any) => u.name === 'B');

			expect(userA).toBeDefined();
			expect(userB).toBeDefined();
			expect(userA!._associations.comments).toHaveLength(2);
			expect(userB!._associations.comments).toHaveLength(1);
		});
	});
});
