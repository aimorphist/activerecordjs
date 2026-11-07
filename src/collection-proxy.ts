import { sql } from 'drizzle-orm';
import type { HasManyConfig } from './types';
import { resolveHasManyForeignKey, resolveBelongsToForeignKey } from './associations';
import { bindModel, requireScope, scopeOf } from './session';

/**
 * CollectionProxy wraps a hasMany association.
 * - Awaitable: `await user.posts` returns Post[]
 * - Has methods: `.count()`, `.build()`, `.create()`
 * - Supports through: associations via intermediary
 */
export class CollectionProxy<T> implements PromiseLike<T[]> {
	private readonly owner: any;
	private readonly associationName: string;
	private readonly config: HasManyConfig;
	private readonly parentModelName: string;

	constructor(owner: any, associationName: string, config: HasManyConfig, parentModelName: string) {
		this.owner = owner;
		this.associationName = associationName;
		this.config = config;
		this.parentModelName = parentModelName;
	}

	/** Bind a related class to the owner's captured scope. */
	private bound(modelClass: any): any {
		return bindModel(modelClass, scopeOf(this.owner));
	}

	/**
	 * Load the association - dispatches to direct or through loading.
	 */
	private async load(): Promise<T[]> {
		// Check instance cache first
		if (this.associationName in this.owner._associations) {
			return this.owner._associations[this.associationName] as T[];
		}

		const result = this.config.through ? await this.loadThrough() : await this.loadDirect();

		this.owner._associations[this.associationName] = result;
		return result;
	}

	/**
	 * Direct FK-based loading (original behavior).
	 */
	private async loadDirect(): Promise<T[]> {
		const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
		const ModelClass = this.owner.constructor;
		const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

		if (primaryKeyValue == null) {
			return [];
		}

		const RelatedModel = this.bound(this.config.model());
		return RelatedModel.where({ [foreignKey]: primaryKeyValue }).all();
	}

	/**
	 * Through-based loading: load intermediary, then collect targets.
	 *
	 * Example: User hasMany comments through posts
	 *   Step 1: Load user.posts (intermediary)
	 *   Step 2: Load comments WHERE postId IN (post IDs)
	 */
	private async loadThrough(): Promise<T[]> {
		const ModelClass = this.owner.constructor;
		const throughAssocName = this.config.through!;

		// Step 1: Load intermediary records
		const throughConfig = ModelClass.hasMany[throughAssocName];
		if (!throughConfig) {
			throw new Error(
				`Through association '${throughAssocName}' not found in hasMany on ${ModelClass.modelName}`
			);
		}

		const throughFK = resolveHasManyForeignKey(ModelClass.modelName, throughConfig);
		const ownerPK = this.owner._data[ModelClass.primaryKey];
		if (ownerPK == null) return [];

		const ThroughModel = this.bound(throughConfig.model());
		const intermediaries = await ThroughModel.where({ [throughFK]: ownerPK }).all();
		if (intermediaries.length === 0) return [];

		// Step 2: Load target records via intermediary
		const intermediaryIds = intermediaries.map((r: any) => r._data[ThroughModel.primaryKey]);
		const TargetModel = this.bound(this.config.model());

		// The FK on the target points to the intermediary model
		const targetFK = resolveHasManyForeignKey(ThroughModel.modelName, this.config);
		return TargetModel.where({}).whereIn(targetFK, intermediaryIds).all();
	}

	/**
	 * Implement PromiseLike for `await user.posts`.
	 */
	then<TResult1 = T[], TResult2 = never>(
		onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
	): Promise<TResult1 | TResult2> {
		return this.load().then(onfulfilled, onrejected);
	}

	/**
	 * Count related records without loading them all.
	 */
	async count(): Promise<number> {
		// For through associations, we need to load and count
		if (this.config.through) {
			const records = await this.load();
			return records.length;
		}

		const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
		const ModelClass = this.owner.constructor;
		const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

		if (primaryKeyValue == null) {
			return 0;
		}

		const RelatedModel = this.bound(this.config.model());
		return RelatedModel.where({ [foreignKey]: primaryKeyValue }).count();
	}

	/**
	 * Build a new related record (not saved) with foreign key set.
	 */
	build(attrs: Record<string, unknown> = {}): T {
		const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
		const ModelClass = this.owner.constructor;
		const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

		const RelatedModel = this.bound(this.config.model());
		const instance = RelatedModel.build({
			...attrs,
			[foreignKey]: primaryKeyValue
		}) as T;

		// Set inverse association (if the related model has a matching belongsTo)
		const relatedBelongsTo = RelatedModel.belongsTo ?? {};
		for (const [assocName, assocConfig] of Object.entries(relatedBelongsTo) as any) {
			const assocFK = resolveBelongsToForeignKey(assocName, assocConfig);
			if (assocFK === foreignKey) {
				// This belongsTo points back to our owner
				(instance as any)._associations[assocName] = this.owner;
				break;
			}
		}

		return instance;
	}

	/**
	 * Create and save a new related record with foreign key set.
	 */
	async create(attrs: Record<string, unknown> = {}): Promise<T> {
		const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
		const ModelClass = this.owner.constructor;
		const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

		const RelatedModel = this.bound(this.config.model());
		const instance = await RelatedModel.create({
			...attrs,
			[foreignKey]: primaryKeyValue
		});

		// Set inverse association (if the related model has a matching belongsTo)
		const relatedBelongsTo = RelatedModel.belongsTo ?? {};
		for (const [assocName, assocConfig] of Object.entries(relatedBelongsTo) as any) {
			const assocFK = resolveBelongsToForeignKey(assocName, assocConfig);
			if (assocFK === foreignKey) {
				// This belongsTo points back to our owner
				instance._associations[assocName] = this.owner;
				break;
			}
		}

		// Invalidate cache so next load gets fresh data
		if (this.associationName in this.owner._associations) {
			delete this.owner._associations[this.associationName];
		}

		return instance as T;
	}

	/**
	 * Clear the loaded cache.
	 */
	reset(): void {
		if (this.associationName in this.owner._associations) {
			delete this.owner._associations[this.associationName];
		}
	}

	/**
	 * Return IDs of all related records.
	 * Uses a SELECT query for just the PK column -- does NOT load full records.
	 */
	async ids(): Promise<number[]> {
		const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
		const ModelClass = this.owner.constructor;
		const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

		if (primaryKeyValue == null) return [];

		const RelatedModel = this.bound(this.config.model());
		const pk = RelatedModel.primaryKey;
		const fkCol = this.toSnakeCase(foreignKey);
		const pkCol = this.toSnakeCase(pk);
		const tableName = RelatedModel.tableName;

		// Efficient: only SELECT the PK column, not full records
		const db = requireScope(scopeOf(this.owner)).session();
		const results: any = await db.execute(
			sql`SELECT ${sql.raw(pkCol)} FROM ${sql.raw(tableName)}
				WHERE ${sql.raw(fkCol)} = ${primaryKeyValue}`
		);
		return results.map((r: any) => r[pkCol]);
	}

	/**
	 * Check if collection is empty.
	 */
	async empty(): Promise<boolean> {
		return (await this.count()) === 0;
	}

	/**
	 * Alias for count().
	 */
	async size(): Promise<number> {
		return this.count();
	}

	/**
	 * Check if collection includes a specific record (by primary key).
	 */
	async includes(record: any): Promise<boolean> {
		const RelatedModel = this.bound(this.config.model());
		const pk = RelatedModel.primaryKey;
		const recordId = record._data?.[pk] ?? record[pk] ?? record;

		const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
		const ModelClass = this.owner.constructor;
		const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

		if (primaryKeyValue == null) return false;

		return RelatedModel.where({ [foreignKey]: primaryKeyValue, [pk]: recordId }).exists();
	}

	/**
	 * Return a QueryBuilder scoped to this association.
	 * Enables: user.posts.where({ published: true }).all()
	 */
	where(conditions: Record<string, unknown>): any {
		const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
		const ModelClass = this.owner.constructor;
		const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

		const RelatedModel = this.bound(this.config.model());
		return RelatedModel.where({ [foreignKey]: primaryKeyValue }).where(conditions);
	}

	/**
	 * Convert camelCase to snake_case for use in raw SQL column references.
	 */
	private toSnakeCase(str: string): string {
		return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
	}
}
