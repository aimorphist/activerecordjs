import type { PgTable } from 'drizzle-orm/pg-core';
import type { ZodSchema } from 'zod';

export type AnyPgTable = PgTable<any>;

export type CustomValidator<T> = (instance: T) => void | Promise<void>;

export type ValidationValue<T = any> = ZodSchema | CustomValidator<T>[];
export type Validations<T = any> = Record<string, ValidationValue<T>>;

export interface SaveOptions {
	validate?: boolean;
}

export interface ModelStatic<T> {
	find(id: number): Promise<T>;
	findBy(attrs: Partial<Record<string, unknown>>): Promise<T | null>;
	all(): Promise<T[]>;
	first(): Promise<T | null>;
	last(): Promise<T | null>;
	create(attrs: Record<string, unknown>, options?: SaveOptions): Promise<T>;
	update(id: number, attrs: Record<string, unknown>): Promise<T>;
	destroy(id: number): Promise<void>;
	build(attrs?: Record<string, unknown>): T;
	new (attrs?: Record<string, unknown>): T;

	// Metadata
	readonly table: AnyPgTable;
	readonly tableName: string;
	readonly primaryKey: string;
	readonly timestamps: { createdAt?: string; updatedAt?: string };
	readonly validations: Validations<T>;
}

export interface ModelInstance {
	id: number | null;
	save(options?: SaveOptions): Promise<this>;
	update(attrs: Record<string, unknown>, options?: SaveOptions): Promise<this>;
	destroy(): Promise<void>;
	validate(): void;
	isValid(): boolean;
	clearErrors(): void;
	readonly isNewRecord: boolean;
	readonly isPersisted: boolean;
	readonly errors: Record<string, string[]>;
}
