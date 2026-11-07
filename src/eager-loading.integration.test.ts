import { describe, expect } from 'vitest';
import { it, useTestScope } from './setup.integration';
import { User, Post, Comment, Profile } from './fixtures/models';

describe('AR6 Phase 2: Eager Loading Integration Tests', () => {
	useTestScope();

	describe('QueryBuilder.whereIn', () => {
		it('returns matching records', async () => {
			const user1 = await User.create({ email: 'a@example.com', name: 'A' });
			const user2 = await User.create({ email: 'b@example.com', name: 'B' });
			await User.create({ email: 'c@example.com', name: 'C' });

			const results = await User.where({}).whereIn('id', [user1.id, user2.id]).all();

			expect(results).toHaveLength(2);
			const names = results.map((r: any) => r.name);
			expect(names).toContain('A');
			expect(names).toContain('B');
		});

		it('returns empty array for empty values', async () => {
			await User.create({ email: 'a@example.com', name: 'A' });

			const results = await User.where({}).whereIn('id', []).all();

			expect(results).toHaveLength(0);
		});

		it('works with count()', async () => {
			const user1 = await User.create({ email: 'a@example.com', name: 'A' });
			const user2 = await User.create({ email: 'b@example.com', name: 'B' });
			await User.create({ email: 'c@example.com', name: 'C' });

			const count = await User.where({}).whereIn('id', [user1.id, user2.id]).count();

			expect(count).toBe(2);
		});

		it('count() with empty whereIn returns 0', async () => {
			await User.create({ email: 'a@example.com', name: 'A' });

			const count = await User.where({}).whereIn('id', []).count();

			expect(count).toBe(0);
		});
	});

	describe('Model.includes', () => {
		it('loads hasMany associations', async () => {
			const user1 = await User.create({ email: 'a@example.com', name: 'A' });
			const user2 = await User.create({ email: 'b@example.com', name: 'B' });
			await Post.create({ title: 'Post 1', userId: user1.id });
			await Post.create({ title: 'Post 2', userId: user1.id });
			await Post.create({ title: 'Post 3', userId: user2.id });

			const users = await User.includes('posts').all();

			expect(users).toHaveLength(2);
			const userA = users.find((u: any) => u.name === 'A');
			const userB = users.find((u: any) => u.name === 'B');

			// Posts should be pre-populated in _associations
			expect(userA).toBeDefined();
			expect(userB).toBeDefined();
			if (!userA || !userB) throw new Error('expected both users');
			expect(userA._associations.posts).toHaveLength(2);
			expect(userB._associations.posts).toHaveLength(1);
		});

		it('loads belongsTo associations', async () => {
			const user = await User.create({ email: 'a@example.com', name: 'A' });
			await Post.create({ title: 'Post 1', userId: user.id });
			await Post.create({ title: 'Post 2', userId: user.id });

			const posts = await Post.includes('user').all();

			expect(posts).toHaveLength(2);
			for (const post of posts) {
				expect(post._associations.user).not.toBeNull();
				expect((post._associations.user as any).name).toBe('A');
			}
		});

		it('loads hasOne associations', async () => {
			const user1 = await User.create({ email: 'a@example.com', name: 'A' });
			const user2 = await User.create({ email: 'b@example.com', name: 'B' });
			await Profile.create({ bio: 'Bio A', userId: user1.id });

			const users = await User.includes('profile').all();

			expect(users).toHaveLength(2);
			const userA = users.find((u: any) => u.name === 'A');
			const userB = users.find((u: any) => u.name === 'B');

			expect(userA).toBeDefined();
			expect(userB).toBeDefined();
			if (!userA || !userB) throw new Error('expected both users');
			expect(userA._associations.profile).not.toBeNull();
			expect((userA._associations.profile as any).bio).toBe('Bio A');
			expect(userB._associations.profile).toBeNull();
		});

		it('loads multiple associations', async () => {
			const user = await User.create({ email: 'a@example.com', name: 'A' });
			await Post.create({ title: 'Post 1', userId: user.id });
			const post2 = await Post.create({ title: 'Post 2', userId: user.id });
			await Comment.create({ body: 'Comment 1', postId: post2.id, userId: user.id });

			const posts = await Post.includes('user', 'comments').all();

			expect(posts).toHaveLength(2);
			for (const post of posts) {
				expect(post._associations.user).not.toBeNull();
			}
			const postWithComment = posts.find((p: any) => p.title === 'Post 2');
			expect(postWithComment).toBeDefined();
			if (!postWithComment) throw new Error('expected the commented post');
			expect(postWithComment._associations.comments).toHaveLength(1);
		});

		it('works with where clause', async () => {
			const user1 = await User.create({ email: 'a@example.com', name: 'A' });
			const user2 = await User.create({ email: 'b@example.com', name: 'B' });
			await Post.create({ title: 'Post 1', userId: user1.id });
			await Post.create({ title: 'Post 2', userId: user2.id });

			const users = await User.includes('posts').where({ email: 'a@example.com' }).all();

			expect(users).toHaveLength(1);
			expect(users[0].name).toBe('A');
			expect(users[0]._associations.posts).toHaveLength(1);
		});

		it('works with limit', async () => {
			await User.create({ email: 'a@example.com', name: 'A' });
			await User.create({ email: 'b@example.com', name: 'B' });
			await User.create({ email: 'c@example.com', name: 'C' });

			const users = await User.includes('posts').limit(2).all();

			expect(users).toHaveLength(2);
			// Each user should have posts pre-loaded (empty arrays)
			for (const user of users) {
				expect(user._associations.posts).toBeDefined();
			}
		});

		it('cached associations prevent lazy load queries', async () => {
			const user = await User.create({ email: 'a@example.com', name: 'A' });
			await Post.create({ title: 'Post 1', userId: user.id });

			const users = await User.includes('posts').all();

			// Access posts - should use cached value from eager loading
			const posts = await users[0].posts;
			expect(posts).toHaveLength(1);
			expect(posts[0].title).toBe('Post 1');
		});

		it('handles no results safely', async () => {
			const users = await User.includes('posts').where({ email: 'nonexistent@example.com' }).all();

			expect(users).toHaveLength(0);
		});

		it('throws for unknown association', async () => {
			await User.create({ email: 'a@example.com', name: 'A' });

			expect(User.includes('nonexistent').all()).rejects.toThrow(
				"Unknown association 'nonexistent' on User"
			);
		});
	});
});
