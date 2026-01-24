import type { PgTable } from 'drizzle-orm/pg-core';

export type AnyPgTable = PgTable<any>;

export interface ModelStatic<T> {
	find(id: number): Promise<T>;
	findBy(attrs: Partial<Record<string, unknown>>): Promise<T | null>;
	all(): Promise<T[]>;
	first(): Promise<T | null>;
	last(): Promise<T | null>;
	create(attrs: Record<string, unknown>): Promise<T>;
	update(id: number, attrs: Record<string, unknown>): Promise<T>;
	destroy(id: number): Promise<void>;
	new (attrs?: Record<string, unknown>): T;
}

export interface ModelInstance {
	id: number | null;
	save(): Promise<this>;
	update(attrs: Record<string, unknown>): Promise<this>;
	destroy(): Promise<void>;
	readonly isNewRecord: boolean;
	readonly isPersisted: boolean;
}
