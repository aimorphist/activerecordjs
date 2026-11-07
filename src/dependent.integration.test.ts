import { describe, expect } from 'vitest';
import { it, useTestScope } from './setup.integration';
import { User, Post, Comment, Profile } from './fixtures/models';
import { Model } from './model';
import { DependentRestrictError } from './errors';
import { usersTable, postsTable, commentsTable, profilesTable } from './fixtures/schema';

// Create test models with dependent options
class UserModelWithDestroyDep extends Model(usersTable) {
	static hasMany = {
		posts: { model: () => Post, dependent: 'destroy' as const }
	};
}

class UserModelWithDestroyDepRecursive extends Model(usersTable) {
	static hasMany = {
		posts: { model: () => PostModelWithDestroyDep, dependent: 'destroy' as const }
	};
}

class PostModelWithDestroyDep extends Model(postsTable) {
	static belongsTo = {
		user: { model: () => UserModelWithDestroyDepRecursive }
	};
	static hasMany = {
		comments: { model: () => Comment, dependent: 'destroy' as const }
	};
}

class UserModelWithDestroyProfile extends Model(usersTable) {
	static hasOne = {
		profile: { model: () => Profile, dependent: 'destroy' as const }
	};
}

class UserModelWithNullifyDep extends Model(usersTable) {
	static hasMany = {
		posts: { model: () => Post, dependent: 'nullify' as const }
	};
}

class UserModelWithNullifyProfile extends Model(usersTable) {
	static hasOne = {
		profile: { model: () => Profile, dependent: 'nullify' as const }
	};
}

class UserModelWithRestrictDep extends Model(usersTable) {
	static hasMany = {
		posts: { model: () => Post, dependent: 'restrict' as const }
	};
}

class UserModelWithMixedDep extends Model(usersTable) {
	static hasMany = {
		posts: { model: () => Post, dependent: 'restrict' as const }
	};
	static hasOne = {
		profile: { model: () => Profile, dependent: 'destroy' as const }
	};
}

class UserModelWithHooks extends Model(usersTable) {
	static hasMany = {
		posts: { model: () => Post, dependent: 'destroy' as const }
	};
	static beforeDestroy = [
		async (instance: any) => {
			// Hook will be set in test
		}
	];
	static afterDestroy = [
		async (instance: any) => {
			// Hook will be set in test
		}
	];
}

describe('AR6 Phase 5: Dependent Option Integration Tests', () => {
	useTestScope();

	describe('dependent: destroy', () => {
		it('deletes hasMany children when parent is destroyed', async () => {
			const user = await UserModelWithDestroyDep.create({
				name: 'Alice',
				email: 'alice@example.com'
			});
			const post1 = await Post.create({ title: 'Post 1', userId: user.id });
			const post2 = await Post.create({ title: 'Post 2', userId: user.id });

			await user.destroy();

			// Verify user is deleted
			const foundUser = await User.findBy({ id: user.id });
			expect(foundUser).toBeNull();

			// Verify posts are deleted
			const foundPosts = await Post.where({ userId: user.id }).all();
			expect(foundPosts).toHaveLength(0);
		});

		it('is recursive - destroys grandchildren too', async () => {
			const user = await UserModelWithDestroyDepRecursive.create({
				name: 'Bob',
				email: 'bob@example.com'
			});
			const post = await PostModelWithDestroyDep.create({ title: 'Post', userId: user.id });
			const comment1 = await Comment.create({
				body: 'Comment 1',
				postId: post.id,
				userId: user.id
			});
			const comment2 = await Comment.create({
				body: 'Comment 2',
				postId: post.id,
				userId: user.id
			});

			await user.destroy();

			// Verify all are deleted
			expect(await User.findBy({ id: user.id })).toBeNull();
			expect(await Post.findBy({ id: post.id })).toBeNull();
			expect(await Comment.findBy({ id: comment1.id })).toBeNull();
			expect(await Comment.findBy({ id: comment2.id })).toBeNull();
		});

		it('works on hasOne associations', async () => {
			const user = await UserModelWithDestroyProfile.create({
				name: 'Charlie',
				email: 'charlie@example.com'
			});
			const profile = await Profile.create({ bio: 'My bio', userId: user.id });

			await user.destroy();

			expect(await User.findBy({ id: user.id })).toBeNull();
			expect(await Profile.findBy({ id: profile.id })).toBeNull();
		});
	});

	describe('dependent: nullify', () => {
		it('sets FK to null on hasMany children', async () => {
			const user = await UserModelWithNullifyDep.create({
				name: 'Dana',
				email: 'dana@example.com'
			});
			const post1 = await Post.create({ title: 'Post 1', userId: user.id });
			const post2 = await Post.create({ title: 'Post 2', userId: user.id });

			await user.destroy();

			// Verify user is deleted
			expect(await User.findBy({ id: user.id })).toBeNull();

			// Verify posts still exist but userId is null
			const foundPost1 = await Post.find(post1.id);
			const foundPost2 = await Post.find(post2.id);

			expect(foundPost1.userId).toBeNull();
			expect(foundPost2.userId).toBeNull();
		});

		it('works on hasOne associations', async () => {
			const user = await UserModelWithNullifyProfile.create({
				name: 'Eve',
				email: 'eve@example.com'
			});
			const profile = await Profile.create({ bio: 'My bio', userId: user.id });

			await user.destroy();

			expect(await User.findBy({ id: user.id })).toBeNull();

			const foundProfile = await Profile.find(profile.id);
			expect(foundProfile.userId).toBeNull();
		});
	});

	describe('dependent: restrict', () => {
		it('prevents destroy when children exist', async () => {
			const user = await UserModelWithRestrictDep.create({
				name: 'Frank',
				email: 'frank@example.com'
			});
			await Post.create({ title: 'Post 1', userId: user.id });

			await expect(user.destroy()).rejects.toThrow(DependentRestrictError);
			await expect(user.destroy()).rejects.toThrow(
				"Cannot destroy User: dependent 'posts' records exist (restrict)"
			);

			// Verify user still exists
			const foundUser = await User.find(user.id);
			expect(foundUser.id).toBe(user.id);
		});

		it('allows destroy when no children exist', async () => {
			const user = await UserModelWithRestrictDep.create({
				name: 'Grace',
				email: 'grace@example.com'
			});

			// Should not throw
			await user.destroy();

			expect(await User.findBy({ id: user.id })).toBeNull();
		});

		it('is checked BEFORE destroy/nullify (fail fast)', async () => {
			const user = await UserModelWithMixedDep.create({
				name: 'Henry',
				email: 'henry@example.com'
			});
			await Post.create({ title: 'Post 1', userId: user.id });
			const profile = await Profile.create({ bio: 'Bio', userId: user.id });

			// Destroy should fail on restrict before processing destroy
			await expect(user.destroy()).rejects.toThrow(DependentRestrictError);

			// Verify profile was NOT destroyed (restrict prevented the whole operation)
			const foundProfile = await Profile.find(profile.id);
			expect(foundProfile.id).toBe(profile.id);
		});
	});

	describe('no dependent option', () => {
		it('does not cascade when no dependent option is set', async () => {
			const user = await User.create({ name: 'Iris', email: 'iris@example.com' });
			const post = await Post.create({ title: 'Post 1', userId: user.id });
			const userId = user.id;
			const postId = post.id;

			// Without dependent option, FK constraint prevents deletion
			await expect(user.destroy()).rejects.toThrow();

			// Transaction is aborted at this point, need to rollback and verify in a new transaction
			// For this test, we just verify that the error was thrown
			// The error indicates FK constraint prevents deletion when no dependent option is set
		});
	});

	describe('lifecycle hooks', () => {
		it('still fires beforeDestroy and afterDestroy hooks', async () => {
			const hooksCalled: string[] = [];

			// Override hooks for this test
			UserModelWithHooks.beforeDestroy = [
				async (instance: any) => {
					hooksCalled.push('beforeDestroy');
				}
			];
			UserModelWithHooks.afterDestroy = [
				async (instance: any) => {
					hooksCalled.push('afterDestroy');
				}
			];

			const user = await UserModelWithHooks.create({ name: 'Jack', email: 'jack@example.com' });
			await Post.create({ title: 'Post 1', userId: user.id });

			await user.destroy();

			expect(hooksCalled).toEqual(['beforeDestroy', 'afterDestroy']);
		});
	});
});
