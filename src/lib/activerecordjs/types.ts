import type { PgTable } from 'drizzle-orm/pg-core';
import type { ZodSchema } from 'zod';

export type AnyPgTable = PgTable<any>;

export type CustomValidator<T> = (instance: T) => void | Promise<void>;

export type ValidationValue<T = any> = ZodSchema | CustomValidator<T>[];
export type Validations<T = any> = Record<string, ValidationValue<T>>;

export type BeforeHook<T> = (instance: T) => void | Promise<void>;
export type AfterHook<T> = (instance: T) => void | Promise<void>;

export interface LifecycleHooks<T> {
	beforeSave: BeforeHook<T>[];
	afterSave: AfterHook<T>[];
	beforeCreate: BeforeHook<T>[];
	afterCreate: AfterHook<T>[];
	beforeUpdate: BeforeHook<T>[];
	afterUpdate: AfterHook<T>[];
	beforeDestroy: BeforeHook<T>[];
	afterDestroy: AfterHook<T>[];
}

// Association configuration types
export type ModelThunk = () => any;  // Returns a Model class

export interface BelongsToConfig {
	model: ModelThunk;
	foreignKey?: string;  // Optional, inferred from association name
}

export interface HasManyConfig {
	model: ModelThunk;
	foreignKey?: string;  // Optional, inferred from parent model name
}

export type BelongsToDeclarations = Record<string, BelongsToConfig>;
export type HasManyDeclarations = Record<string, HasManyConfig>;

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

	// Lifecycle Hooks
	readonly beforeSave?: BeforeHook<T>[];
	readonly afterSave?: AfterHook<T>[];
	readonly beforeCreate?: BeforeHook<T>[];
	readonly afterCreate?: AfterHook<T>[];
	readonly beforeUpdate?: BeforeHook<T>[];
	readonly afterUpdate?: AfterHook<T>[];
	readonly beforeDestroy?: BeforeHook<T>[];
	readonly afterDestroy?: AfterHook<T>[];
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
