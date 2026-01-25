import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';

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
