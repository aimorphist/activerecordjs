import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import {
	inferBelongsToForeignKey,
	inferHasManyForeignKey,
	resolveBelongsToForeignKey,
	resolveHasManyForeignKey
} from './associations';
import type { BelongsToConfig, HasManyConfig } from './types';

describe('AR5: Association Foreign Key Inference', () => {
	describe('inferBelongsToForeignKey', () => {
		it('converts association name to foreign key', () => {
			expect(inferBelongsToForeignKey('user')).toBe('userId');
		});

		it('handles camelCase association names', () => {
			expect(inferBelongsToForeignKey('authorUser')).toBe('authorUserId');
		});

		it('handles single word association names', () => {
			expect(inferBelongsToForeignKey('post')).toBe('postId');
		});
	});

	describe('inferHasManyForeignKey', () => {
		it('converts parent model class name to foreign key', () => {
			expect(inferHasManyForeignKey('User')).toBe('userId');
		});

		it('handles multi-word PascalCase model names', () => {
			expect(inferHasManyForeignKey('BlogPost')).toBe('blogPostId');
		});

		it('handles single word model names', () => {
			expect(inferHasManyForeignKey('Post')).toBe('postId');
		});
	});

	describe('resolveBelongsToForeignKey', () => {
		it('uses explicit foreignKey when provided', () => {
			const config: BelongsToConfig = {
				model: () => ({}),
				foreignKey: 'authorId'
			};
			expect(resolveBelongsToForeignKey('user', config)).toBe('authorId');
		});

		it('infers foreignKey when not provided', () => {
			const config: BelongsToConfig = {
				model: () => ({})
			};
			expect(resolveBelongsToForeignKey('user', config)).toBe('userId');
		});
	});

	describe('resolveHasManyForeignKey', () => {
		it('uses explicit foreignKey when provided', () => {
			const config: HasManyConfig = {
				model: () => ({}),
				foreignKey: 'ownerId'
			};
			expect(resolveHasManyForeignKey('User', config)).toBe('ownerId');
		});

		it('infers foreignKey when not provided', () => {
			const config: HasManyConfig = {
				model: () => ({})
			};
			expect(resolveHasManyForeignKey('User', config)).toBe('userId');
		});
	});
});
