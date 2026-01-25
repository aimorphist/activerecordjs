import { eq, desc, asc, getTableName, getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z, ZodSchema } from 'zod';
import { getGlobalConnection, setGlobalConnection } from './connection';
import { RecordNotFoundError, ValidationError } from './errors';
import { QueryBuilder } from './query-builder';

// Validation types
type CustomValidator<T> = (instance: T) => void | Promise<void>;
type ValidationValue = ZodSchema | CustomValidator<any>[];

interface SaveOptions {
	validate?: boolean;
}

// Use 'any' liberally for metaprogramming per PRD: "TypeScript where helpful, any where necessary"

// Derive model name from table name (e.g., "users" -> "User", "user_posts" -> "UserPost")
function deriveModelName(tableName: string): string {
	return tableName
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join('')
		.replace(/s$/, ''); // Remove trailing 's' for plural table names
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
	const modelName = deriveModelName(tableName);

	return { primaryKey, timestamps, tableName, modelName };
}

export function Model<T extends PgTable>(table: T) {
	const conventions = detectConventions(table);

	const ModelClass = class {
		// Index signature for dynamic attribute access via Proxy
		[key: string]: any;

		// Instance state
		_data: Record<string, unknown>;
		_persisted: boolean;
		_errors: Record<string, string[]> = {};

		// Static metadata
		static table = table;
		static tableName = conventions.tableName;
		static primaryKey = conventions.primaryKey;
		static timestamps = conventions.timestamps;

		// Placeholder for subclass validations (AR3)
		static validations: Record<string, unknown> = {};

		constructor(attrs: Record<string, unknown> = {}, persisted = false) {
			this._data = { ...attrs };
			this._persisted = persisted;

			// Return Proxy for dynamic attribute access
			return new Proxy(this, {
				get(target, prop: string) {
					// Instance properties and methods first
					if (prop in target || prop.startsWith('_')) {
						return (target as any)[prop];
					}
					// Then check data
					return target._data[prop];
				},
				set(target, prop: string, value) {
					if (prop.startsWith('_')) {
						(target as any)[prop] = value;
					} else {
						target._data[prop] = value;
					}
					return true;
				}
			});
		}

		// Instance getters
		get isNewRecord(): boolean {
			return !this._persisted;
		}

		get isPersisted(): boolean {
			return this._persisted;
		}

		get errors(): Record<string, string[]> {
			return this._errors;
		}

		// Validation methods
		isValid(): boolean {
			try {
				this.validate();
				return true;
			} catch {
				return false;
			}
		}

		validate(): void {
			const ModelClass = this.constructor as typeof ModelClass;
			const validations = ModelClass.validations as Record<string, ValidationValue>;
			this._errors = {};

			// Run Zod validators for each field
			for (const [field, validator] of Object.entries(validations)) {
				if (field === '$custom') continue;

				if (validator instanceof z.ZodType) {
					const value = this._data[field];
					const result = validator.safeParse(value);

					if (!result.success) {
						this._errors[field] = result.error.errors.map((e) => e.message);
					}
				}
			}

			// Run custom validators
			const customValidators = (validations.$custom as CustomValidator<any>[]) ?? [];
			for (const validator of customValidators) {
				try {
					validator(this);
				} catch (e) {
					if (e instanceof ValidationError) {
						// Merge errors from custom validator
						for (const [field, messages] of Object.entries(e.errors)) {
							this._errors[field] = [...(this._errors[field] ?? []), ...messages];
						}
					} else {
						throw e;
					}
				}
			}

			// Throw if any errors
			if (Object.keys(this._errors).length > 0) {
				throw new ValidationError(this._errors);
			}
		}

		clearErrors(): void {
			this._errors = {};
		}

		// Instance methods
		async save(options: SaveOptions = {}): Promise<this> {
			const { validate = true } = options;
			const ModelClass = this.constructor as typeof ModelClass;
			const db = getGlobalConnection();
			const { primaryKey, timestamps } = ModelClass;

			// Run validations unless explicitly skipped
			if (validate) {
				this.validate();
			}

			// Auto-manage updated_at
			if (timestamps.updatedAt) {
				this._data[timestamps.updatedAt] = new Date();
			}

			if (this._persisted) {
				// Update existing record
				const id = this._data[primaryKey] as number;
				const updateData = { ...this._data };
				delete updateData[primaryKey];

				await (db as any)
					.update(ModelClass.table)
					.set(updateData)
					.where(eq((ModelClass.table as any)[primaryKey], id));
			} else {
				// Insert new record
				if (timestamps.createdAt && !this._data[timestamps.createdAt]) {
					this._data[timestamps.createdAt] = new Date();
				}

				const [result] = await (db as any).insert(ModelClass.table).values(this._data).returning();

				Object.assign(this._data, result);
				this._persisted = true;
			}

			return this;
		}

		async update(attrs: Record<string, unknown>, options: SaveOptions = {}): Promise<this> {
			Object.assign(this._data, attrs);
			return this.save(options);
		}

		async destroy(): Promise<void> {
			if (!this._persisted) return;

			const ModelClass = this.constructor as typeof ModelClass;
			const db = getGlobalConnection();
			const { primaryKey } = ModelClass;
			const id = this._data[primaryKey] as number;

			await (db as any)
				.delete(ModelClass.table)
				.where(eq((ModelClass.table as any)[primaryKey], id));

			this._persisted = false;
		}

		/**
		 * Reload the record from the database, discarding any unsaved changes.
		 * @throws RecordNotFoundError if the record no longer exists in the database
		 * @throws Error if called on a new (unpersisted) record
		 */
		async reload(): Promise<this> {
			if (!this._persisted) {
				throw new Error('Cannot reload a new record that has not been saved');
			}

			const ModelClass = this.constructor as typeof ModelClass;
			const db = getGlobalConnection();
			const { primaryKey } = ModelClass;
			const id = this._data[primaryKey] as number;

			const [result] = await (db as any)
				.select()
				.from(ModelClass.table)
				.where(eq((ModelClass.table as any)[primaryKey], id))
				.limit(1);

			if (!result) {
				throw new RecordNotFoundError(ModelClass.tableName, id);
			}

			// Reset all data to match database state
			this._data = { ...result };
			this._errors = {};

			return this;
		}

		// Static methods
		static async find(id: number): Promise<InstanceType<typeof this>> {
			const db = getGlobalConnection();
			const pk = this.primaryKey;

			const [result] = await (db as any)
				.select()
				.from(this.table)
				.where(eq((this.table as any)[pk], id))
				.limit(1);

			if (!result) {
				throw new RecordNotFoundError(this.tableName, id);
			}

			return new this(result, true) as InstanceType<typeof this>;
		}

		static async findBy(
			attrs: Partial<Record<string, unknown>>
		): Promise<InstanceType<typeof this> | null> {
			const db = getGlobalConnection();

			let query: any = (db as any).select().from(this.table);

			for (const [key, value] of Object.entries(attrs)) {
				query = query.where(eq((this.table as any)[key], value));
			}

			const [result] = await query.limit(1);

			if (!result) return null;

			return new this(result, true) as InstanceType<typeof this>;
		}

		static async all(): Promise<InstanceType<typeof this>[]> {
			const db = getGlobalConnection();
			const results = await (db as any).select().from(this.table);
			return results.map((r: any) => new this(r, true) as InstanceType<typeof this>);
		}

		static async first(): Promise<InstanceType<typeof this> | null> {
			const db = getGlobalConnection();
			const pk = this.primaryKey;

			const [result] = await (db as any)
				.select()
				.from(this.table)
				.orderBy(asc((this.table as any)[pk]))
				.limit(1);

			if (!result) return null;

			return new this(result, true) as InstanceType<typeof this>;
		}

		static async last(): Promise<InstanceType<typeof this> | null> {
			const db = getGlobalConnection();
			const pk = this.primaryKey;

			const [result] = await (db as any)
				.select()
				.from(this.table)
				.orderBy(desc((this.table as any)[pk]))
				.limit(1);

			if (!result) return null;

			return new this(result, true) as InstanceType<typeof this>;
		}

		static async create(
			attrs: Record<string, unknown>,
			options: SaveOptions = {}
		): Promise<InstanceType<typeof this>> {
			const instance = new this(attrs, false);
			await instance.save(options);
			return instance as InstanceType<typeof this>;
		}

		static async update(
			id: number,
			attrs: Record<string, unknown>
		): Promise<InstanceType<typeof this>> {
			const instance = await this.find(id);
			await instance.update(attrs);
			return instance;
		}

		static async destroy(id: number): Promise<void> {
			const db = getGlobalConnection();
			const pk = this.primaryKey;

			await (db as any).delete(this.table).where(eq((this.table as any)[pk], id));
		}

		// Aliases for 'new' (reserved word)
		static build(attrs?: Record<string, unknown>): InstanceType<typeof this> {
			return new this(attrs, false) as InstanceType<typeof this>;
		}

		static ['new'](attrs?: Record<string, unknown>): InstanceType<typeof this> {
			return new this(attrs, false) as InstanceType<typeof this>;
		}

		// Query builder entry points
		static where(
			conditionsOrSql: Record<string, unknown> | string,
			...params: unknown[]
		): QueryBuilder<T, InstanceType<typeof this>> {
			const ModelClass = this;
			const builder = new QueryBuilder<T, InstanceType<typeof this>>(
				this.table,
				(data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
				this
			);
			if (typeof conditionsOrSql === 'string') {
				return builder.where(conditionsOrSql, ...params);
			}
			return builder.where(conditionsOrSql);
		}

		static order(
			column: string,
			direction: 'asc' | 'desc' = 'asc'
		): QueryBuilder<T, InstanceType<typeof this>> {
			const ModelClass = this;
			const builder = new QueryBuilder<T, InstanceType<typeof this>>(
				this.table,
				(data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
				this
			);
			return builder.order(column, direction);
		}

		static limit(n: number): QueryBuilder<T, InstanceType<typeof this>> {
			const ModelClass = this;
			const builder = new QueryBuilder<T, InstanceType<typeof this>>(
				this.table,
				(data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
				this
			);
			return builder.limit(n);
		}

		static offset(n: number): QueryBuilder<T, InstanceType<typeof this>> {
			const ModelClass = this;
			const builder = new QueryBuilder<T, InstanceType<typeof this>>(
				this.table,
				(data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
				this
			);
			return builder.offset(n);
		}

		static async count(): Promise<number> {
			const ModelClass = this;
			const builder = new QueryBuilder<T, InstanceType<typeof this>>(
				this.table,
				(data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
				this
			);
			return builder.count();
		}

		static async exists(conditions?: Record<string, unknown>): Promise<boolean> {
			const ModelClass = this;
			let builder = new QueryBuilder<T, InstanceType<typeof this>>(
				this.table,
				(data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
				this
			);
			if (conditions) {
				builder = builder.where(conditions);
			}
			return builder.exists();
		}

		static async findOrCreate(
			findAttrs: Record<string, unknown>,
			createAttrs: Record<string, unknown> = {}
		): Promise<InstanceType<typeof this>> {
			const existing = await this.findBy(findAttrs);
			if (existing) return existing;
			return this.create({ ...findAttrs, ...createAttrs });
		}

		static async firstOrCreate(
			findAttrs: Record<string, unknown>,
			createAttrs: Record<string, unknown> = {}
		): Promise<InstanceType<typeof this>> {
			return this.findOrCreate(findAttrs, createAttrs);
		}

		static async query<R>(fn: (table: T, db: PostgresJsDatabase) => Promise<R>): Promise<R> {
			const db = getGlobalConnection();
			return fn(this.table, db);
		}
	};

	// Set the class name dynamically based on table name
	Object.defineProperty(ModelClass, 'name', { value: conventions.modelName });

	return ModelClass;
}

export function createActiveRecordJS(db: PostgresJsDatabase): { Model: typeof Model } {
	setGlobalConnection(db);
	return { Model };
}
