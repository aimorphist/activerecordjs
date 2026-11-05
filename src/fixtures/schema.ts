import { pgTable, serial, text, timestamp, integer, primaryKey } from 'drizzle-orm/pg-core';

export const usersTable = pgTable('users', {
	id: serial('id').primaryKey(),
	name: text('name'),
	email: text('email').notNull(),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow()
});

export const postsTable = pgTable('posts', {
	id: serial('id').primaryKey(),
	title: text('title').notNull(),
	body: text('body'),
	userId: integer('user_id').references(() => usersTable.id),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow()
});

export const commentsTable = pgTable('comments', {
	id: serial('id').primaryKey(),
	body: text('body').notNull(),
	postId: integer('post_id').references(() => postsTable.id),
	userId: integer('user_id').references(() => usersTable.id),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow()
});

export const profilesTable = pgTable('profiles', {
	id: serial('id').primaryKey(),
	bio: text('bio'),
	avatarUrl: text('avatar_url'),
	userId: integer('user_id').references(() => usersTable.id),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow()
});

export const tagsTable = pgTable('tags', {
	id: serial('id').primaryKey(),
	name: text('name').notNull()
});

export const postsTagsTable = pgTable(
	'posts_tags',
	{
		postId: integer('post_id')
			.references(() => postsTable.id)
			.notNull(),
		tagId: integer('tag_id')
			.references(() => tagsTable.id)
			.notNull()
	},
	(t) => [primaryKey({ columns: [t.postId, t.tagId] })]
);
