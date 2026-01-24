import { eq, desc, asc, getTableName, getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getGlobalConnection, setGlobalConnection } from './connection';
import { RecordNotFoundError } from './errors';
import { QueryBuilder } from './query-builder';

// Use 'any' liberally for metaprogramming per PRD: "TypeScript where helpful, any where necessary"

interface ModelClass<T extends PgTable> {
	// Static methods
	find(id: number): Promise<ModelInstanceType<T>>;
	findBy(attrs: Partial<Record<string, unknown>>): Promise<ModelInstanceType<T> | null>;
	all(): Promise<ModelInstanceType<T>[]>;
	first(): Promise<ModelInstanceType<T> | null>;
	last(): Promise<ModelInstanceType<T> | null>;
	create(attrs: Record<string, unknown>): Promise<ModelInstanceType<T>>;
	update(id: number, attrs: Record<string, unknown>): Promise<ModelInstanceType<T>>;
	destroy(id: number): Promise<void>;
	// 'new' is a reserved word, use bracket access or 'build' alias
	['new'](attrs?: Record<string, unknown>): ModelInstanceType<T>;
	build(attrs?: Record<string, unknown>): ModelInstanceType<T>;

	// Query builder methods
	where(conditions: Record<string, unknown>): QueryBuilder<T, ModelInstanceType<T>>;
	where(sql: string, ...params: unknown[]): QueryBuilder<T, ModelInstanceType<T>>;
	order(column: string, direction?: 'asc' | 'desc'): QueryBuilder<T, ModelInstanceType<T>>;
	limit(n: number): QueryBuilder<T, ModelInstanceType<T>>;
	offset(n: number): QueryBuilder<T, ModelInstanceType<T>>;
	count(): Promise<number>;
	exists(conditions?: Record<string, unknown>): Promise<boolean>;
	findOrCreate(
		findAttrs: Record<string, unknown>,
		createAttrs?: Record<string, unknown>
	): Promise<ModelInstanceType<T>>;
	firstOrCreate(
		findAttrs: Record<string, unknown>,
		createAttrs?: Record<string, unknown>
	): Promise<ModelInstanceType<T>>;
	query<R>(fn: (table: T, db: PostgresJsDatabase) => Promise<R>): Promise<R>;

	// Metadata
	readonly table: T;
	readonly tableName: string;
	readonly primaryKey: string;
	readonly timestamps: { createdAt?: string; updatedAt?: string };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface ModelInstanceType<T extends PgTable> {
	id: number | null;
	save(): Promise<this>;
	update(attrs: Record<string, unknown>): Promise<this>;
	destroy(): Promise<void>;
	readonly isNewRecord: boolean;
	readonly isPersisted: boolean;
	[key: string]: any;
}

// Detect conventions from table schema
function detectConventions<T extends PgTable>(table: T) {
	const columns = getTableColumns(table);

	// Find primary key (convention: 'id')
	let primaryKey = 'id';
	for (const [name, col] of Object.entries(columns)) {
		if ((col as any).primary) {
			primaryKey = name;
			break;
		}
	}

	// Detect timestamp columns
	const timestamps: { createdAt?: string; updatedAt?: string } = {};
	if ('createdAt' in columns) timestamps.createdAt = 'createdAt';
	if ('created_at' in columns) timestamps.createdAt = 'created_at';
	if ('updatedAt' in columns) timestamps.updatedAt = 'updatedAt';
	if ('updated_at' in columns) timestamps.updatedAt = 'updated_at';

	// Table name from Drizzle table config
	const tableName = getTableName(table);

	return { primaryKey, timestamps, tableName };
}

// Create a model instance with Proxy for attribute access
function createInstance<T extends PgTable>(
	ModelClass: ModelClass<T>,
	attrs: Record<string, unknown>,
	persisted: boolean
): ModelInstanceType<T> {
	const data = { ...attrs };
	let _persisted = persisted;

	// Self-reference for returning from methods (will be set after Proxy creation)
	// eslint-disable-next-line prefer-const
	let proxy: ModelInstanceType<T>;

	const instance: any = {
		get isNewRecord() {
			return !_persisted;
		},
		get isPersisted() {
			return _persisted;
		},

		async save(): Promise<ModelInstanceType<T>> {
			const db = getGlobalConnection();
			const { primaryKey, timestamps } = ModelClass;

			// Auto-manage updated_at
			if (timestamps.updatedAt) {
				data[timestamps.updatedAt] = new Date();
			}

			if (_persisted) {
				// Update existing record
				const id = data[primaryKey] as number;
				const updateData = { ...data };
				delete updateData[primaryKey];

				await (db as any)
					.update(ModelClass.table)
					.set(updateData)
					.where(eq((ModelClass.table as any)[primaryKey], id));
			} else {
				// Insert new record
				if (timestamps.createdAt && !data[timestamps.createdAt]) {
					data[timestamps.createdAt] = new Date();
				}

				const [result] = await (db as any).insert(ModelClass.table).values(data).returning();

				Object.assign(data, result);
				_persisted = true;
			}

			return proxy;
		},

		async update(attrs: Record<string, unknown>): Promise<ModelInstanceType<T>> {
			Object.assign(data, attrs);
			return instance.save();
		},

		async destroy(): Promise<void> {
			if (!_persisted) return;

			const db = getGlobalConnection();
			const { primaryKey } = ModelClass;
			const id = data[primaryKey] as number;

			await (db as any)
				.delete(ModelClass.table)
				.where(eq((ModelClass.table as any)[primaryKey], id));

			_persisted = false;
		}
	};

	// Create Proxy for dynamic attribute access
	proxy = new Proxy(instance, {
		get(target, prop: string) {
			if (prop in target) {
				return target[prop];
			}
			return data[prop];
		},
		set(_target, prop: string, value) {
			data[prop] = value;
			return true;
		}
	}) as ModelInstanceType<T>;

	return proxy;
}

export function Model<T extends PgTable>(table: T): ModelClass<T> {
	const conventions = detectConventions(table);

	const buildInstance = (attrs: Record<string, unknown> = {}): ModelInstanceType<T> => {
		return createInstance(ModelClass, attrs, false);
	};

	const ModelClass: ModelClass<T> = {
		table,
		tableName: conventions.tableName,
		primaryKey: conventions.primaryKey,
		timestamps: conventions.timestamps,

		async find(id: number): Promise<ModelInstanceType<T>> {
			const db = getGlobalConnection();
			const pk = conventions.primaryKey;

			const [result] = await (db as any)
				.select()
				.from(table)
				.where(eq((table as any)[pk], id))
				.limit(1);

			if (!result) {
				throw new RecordNotFoundError(conventions.tableName, id);
			}

			return createInstance(ModelClass, result, true);
		},

		async findBy(attrs: Partial<Record<string, unknown>>): Promise<ModelInstanceType<T> | null> {
			const db = getGlobalConnection();

			let query: any = (db as any).select().from(table);

			for (const [key, value] of Object.entries(attrs)) {
				query = query.where(eq((table as any)[key], value));
			}

			const [result] = await query.limit(1);

			if (!result) return null;

			return createInstance(ModelClass, result, true);
		},

		async all(): Promise<ModelInstanceType<T>[]> {
			const db = getGlobalConnection();
			const results = await (db as any).select().from(table);
			return results.map((r: any) => createInstance(ModelClass, r, true));
		},

		async first(): Promise<ModelInstanceType<T> | null> {
			const db = getGlobalConnection();
			const pk = conventions.primaryKey;

			const [result] = await (db as any)
				.select()
				.from(table)
				.orderBy(asc((table as any)[pk]))
				.limit(1);

			if (!result) return null;

			return createInstance(ModelClass, result, true);
		},

		async last(): Promise<ModelInstanceType<T> | null> {
			const db = getGlobalConnection();
			const pk = conventions.primaryKey;

			const [result] = await (db as any)
				.select()
				.from(table)
				.orderBy(desc((table as any)[pk]))
				.limit(1);

			if (!result) return null;

			return createInstance(ModelClass, result, true);
		},

		async create(attrs: Record<string, unknown>): Promise<ModelInstanceType<T>> {
			const instance = buildInstance(attrs);
			await instance.save();
			return instance;
		},

		async update(id: number, attrs: Record<string, unknown>): Promise<ModelInstanceType<T>> {
			const instance = await ModelClass.find(id);
			await instance.update(attrs);
			return instance;
		},

		async destroy(id: number): Promise<void> {
			const db = getGlobalConnection();
			const pk = conventions.primaryKey;

			await (db as any).delete(table).where(eq((table as any)[pk], id));
		},

		// 'new' method - use bracket notation since 'new' is reserved
		['new']: buildInstance,

		// Alias for 'new' that doesn't conflict with reserved word
		build: buildInstance,

		// Query builder entry points
		where(
			conditionsOrSql: Record<string, unknown> | string,
			...params: unknown[]
		): QueryBuilder<T, ModelInstanceType<T>> {
			const builder = new QueryBuilder(
				table,
				(data, persisted) => createInstance(ModelClass, data, persisted),
				ModelClass
			);
			if (typeof conditionsOrSql === 'string') {
				return builder.where(conditionsOrSql, ...params);
			}
			return builder.where(conditionsOrSql);
		},

		order(
			column: string,
			direction: 'asc' | 'desc' = 'asc'
		): QueryBuilder<T, ModelInstanceType<T>> {
			const builder = new QueryBuilder(
				table,
				(data, persisted) => createInstance(ModelClass, data, persisted),
				ModelClass
			);
			return builder.order(column, direction);
		},

		limit(n: number): QueryBuilder<T, ModelInstanceType<T>> {
			const builder = new QueryBuilder(
				table,
				(data, persisted) => createInstance(ModelClass, data, persisted),
				ModelClass
			);
			return builder.limit(n);
		},

		offset(n: number): QueryBuilder<T, ModelInstanceType<T>> {
			const builder = new QueryBuilder(
				table,
				(data, persisted) => createInstance(ModelClass, data, persisted),
				ModelClass
			);
			return builder.offset(n);
		},

		async count(): Promise<number> {
			const builder = new QueryBuilder(
				table,
				(data, persisted) => createInstance(ModelClass, data, persisted),
				ModelClass
			);
			return builder.count();
		},

		async exists(conditions?: Record<string, unknown>): Promise<boolean> {
			let builder = new QueryBuilder(
				table,
				(data, persisted) => createInstance(ModelClass, data, persisted),
				ModelClass
			);
			if (conditions) {
				builder = builder.where(conditions);
			}
			return builder.exists();
		},

		async findOrCreate(
			findAttrs: Record<string, unknown>,
			createAttrs: Record<string, unknown> = {}
		): Promise<ModelInstanceType<T>> {
			const existing = await ModelClass.findBy(findAttrs);
			if (existing) return existing;
			return ModelClass.create({ ...findAttrs, ...createAttrs });
		},

		async firstOrCreate(
			findAttrs: Record<string, unknown>,
			createAttrs: Record<string, unknown> = {}
		): Promise<ModelInstanceType<T>> {
			// Alias for findOrCreate (Rails naming)
			return ModelClass.findOrCreate(findAttrs, createAttrs);
		},

		async query<R>(fn: (table: T, db: PostgresJsDatabase) => Promise<R>): Promise<R> {
			const db = getGlobalConnection();
			return fn(table, db);
		}
	};

	return ModelClass;
}

export function createActiveRecordJS(db: PostgresJsDatabase): { Model: typeof Model } {
	setGlobalConnection(db);
	return { Model };
}
