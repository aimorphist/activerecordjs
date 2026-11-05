import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
	setupTestDb,
	teardownTestDb,
	beginTestTransaction,
	rollbackTestTransaction
} from './setup.integration';
import { User, Post, Comment, Profile } from './fixtures/models';

describe('AR6 Phase 1: hasOne Integration Tests', () => {
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

	describe('hasOne', () => {
		it('loads related record via hasOne', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Profile.create({ bio: 'Hello world', userId: user.id });

			const profile = await user.profile;

			expect(profile).not.toBeNull();
			expect(profile.bio).toBe('Hello world');
			expect(profile.userId).toBe(user.id);
		});

		it('returns null when no related record exists', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });

			const profile = await user.profile;

			expect(profile).toBeNull();
		});

		it('returns null for unsaved owner', async () => {
			const user = User.build({ email: 'test@example.com' });

			const profile = await user.profile;

			expect(profile).toBeNull();
		});

		it('caches the loaded association', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Profile.create({ bio: 'Hello', userId: user.id });

			// First load
			const firstLoad = await user.profile;
			// Second load (should be cached)
			const secondLoad = await user.profile;

			expect(firstLoad.id).toBe(secondLoad.id);
			expect(firstLoad.bio).toBe(secondLoad.bio);
		});

		it('clears cache on reload()', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			const profile = await Profile.create({ bio: 'Original', userId: user.id });

			// Load association
			const loaded = await user.profile;
			expect(loaded.bio).toBe('Original');

			// Update bio directly in database
			await profile.update({ bio: 'Updated' });

			// Should still have old value in cache
			const cached = await user.profile;
			expect(cached.bio).toBe('Original');

			// After reload, should get fresh data
			await user.reload();
			const fresh = await user.profile;
			expect(fresh.bio).toBe('Updated');
		});

		it('FK inference works (userId inferred from User model name)', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Profile.create({ bio: 'FK test', userId: user.id });

			// The hasOne config doesn't specify foreignKey, so it should be inferred as 'userId'
			const profile = await user.profile;
			expect(profile).not.toBeNull();
			expect(profile.bio).toBe('FK test');
		});

		it('existing hasMany still works alongside hasOne', async () => {
			const user = await User.create({ email: 'test@example.com', name: 'Test User' });
			await Profile.create({ bio: 'Profile', userId: user.id });
			await Post.create({ title: 'Post 1', userId: user.id });
			await Post.create({ title: 'Post 2', userId: user.id });

			// hasOne
			const profile = await user.profile;
			expect(profile).not.toBeNull();
			expect(profile.bio).toBe('Profile');

			// hasMany still works
			const posts = await user.posts;
			expect(posts).toHaveLength(2);
		});
	});
});
