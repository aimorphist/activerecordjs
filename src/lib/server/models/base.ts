import { db } from '$lib/server/db';
import { eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/**
 * Temporary ActiveRecord-style helpers until Bagpipe ORM is ready.
 * API matches the ORM's planned interface.
 */
export function createModelHelpers<
	TTable extends PgTable,
	TSelect extends Record<string, unknown>,
	TInsert extends Record<string, unknown>
>(table: TTable, idColumn: keyof TSelect & string = 'id' as keyof TSelect & string) {
	// Use explicit any cast to work around Drizzle's complex generics
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const tableAny = table as any;

	return {
		async find(id: string): Promise<TSelect> {
			const [result] = await db.select().from(tableAny).where(eq(tableAny[idColumn], id)).limit(1);

			if (!result) {
				throw new Error(`Record not found: ${id}`);
			}

			return result as TSelect;
		},

		async findBy(attrs: Partial<TSelect>): Promise<TSelect | null> {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let query: any = db.select().from(tableAny);

			for (const [key, value] of Object.entries(attrs)) {
				query = query.where(eq(tableAny[key], value));
			}

			const [result] = await query.limit(1);
			return (result as TSelect) ?? null;
		},

		async all(): Promise<TSelect[]> {
			const results = await db.select().from(tableAny);
			return results as TSelect[];
		},

		async create(attrs: TInsert): Promise<TSelect> {
			const now = new Date();
			const data = {
				...attrs,
				createdAt: now,
				updatedAt: now
			};

			const [result] = await db.insert(tableAny).values(data).returning();
			return result as TSelect;
		},

		async update(id: string, attrs: Partial<TInsert>): Promise<TSelect> {
			const data = {
				...attrs,
				updatedAt: new Date()
			};

			const [result] = await db
				.update(tableAny)
				.set(data)
				.where(eq(tableAny[idColumn], id))
				.returning();

			if (!result) {
				throw new Error(`Record not found: ${id}`);
			}

			return result as TSelect;
		},

		async destroy(id: string): Promise<void> {
			await db.delete(tableAny).where(eq(tableAny[idColumn], id));
		},

		async where(attrs: Partial<TSelect>): Promise<TSelect[]> {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let query: any = db.select().from(tableAny);

			for (const [key, value] of Object.entries(attrs)) {
				query = query.where(eq(tableAny[key], value));
			}

			const results = await query;
			return results as TSelect[];
		}
	};
}
