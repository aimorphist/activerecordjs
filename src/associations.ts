import type {
	BelongsToConfig,
	HasManyConfig,
	HasOneConfig,
	HasAndBelongsToManyConfig
} from './types';
import { sql } from 'drizzle-orm';
import { DependentRestrictError } from './errors';
import { bindModel, requireScope, scopeOf } from './session';

/**
 * Convert camelCase to snake_case for use in raw SQL column references.
 * Drizzle uses camelCase in JS but DB columns are snake_case.
 * e.g., 'postId' -> 'post_id', 'associationForeignKey' -> 'association_foreign_key'
 */
export function toSnakeCase(str: string): string {
	return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Infer foreign key from association name.
 * 'user' -> 'userId'
 * 'authorUser' -> 'authorUserId'
 */
export function inferBelongsToForeignKey(associationName: string): string {
	return associationName + 'Id';
}

/**
 * Infer foreign key from parent model's CLASS NAME (PascalCase).
 *
 * IMPORTANT: Pass the model's class name (e.g., 'User'), NOT the table name (e.g., 'users').
 *
 * Parent 'User' -> 'userId'
 * Parent 'BlogPost' -> 'blogPostId'
 */
export function inferHasManyForeignKey(parentModelName: string): string {
	// Convert 'User' to 'userId', 'BlogPost' to 'blogPostId'
	return parentModelName.charAt(0).toLowerCase() + parentModelName.slice(1) + 'Id';
}

/**
 * Resolve the foreign key for a belongsTo association.
 */
export function resolveBelongsToForeignKey(
	associationName: string,
	config: BelongsToConfig
): string {
	return config.foreignKey ?? inferBelongsToForeignKey(associationName);
}

/**
 * Resolve the foreign key for a hasMany association.
 *
 * @param parentModelName - The parent model's CLASS NAME (PascalCase), e.g., 'User'
 * @param config - The hasMany configuration
 */
export function resolveHasManyForeignKey(parentModelName: string, config: HasManyConfig): string {
	return config.foreignKey ?? inferHasManyForeignKey(parentModelName);
}

/**
 * Load a belongsTo association.
 */
export async function loadBelongsTo(
	instance: any,
	associationName: string,
	config: BelongsToConfig
): Promise<any> {
	const foreignKey = resolveBelongsToForeignKey(associationName, config);
	const foreignKeyValue = instance._data[foreignKey];

	if (foreignKeyValue == null) {
		return null; // No foreign key set
	}

	// Related lookup runs on the owner's captured scope, not the related class's.
	const RelatedModel = bindModel(config.model(), scopeOf(instance));
	return RelatedModel.find(foreignKeyValue);
}

/**
 * Resolve the foreign key for a hasOne association.
 * Same logic as hasMany -- FK is on the related model.
 *
 * @param parentModelName - The parent model's CLASS NAME (PascalCase), e.g., 'User'
 * @param config - The hasOne configuration
 */
export function resolveHasOneForeignKey(parentModelName: string, config: HasOneConfig): string {
	return config.foreignKey ?? inferHasManyForeignKey(parentModelName);
}

/**
 * Load a hasOne association. Returns single record or null.
 */
export async function loadHasOne(
	instance: any,
	associationName: string,
	config: HasOneConfig,
	parentModelName: string
): Promise<any> {
	const foreignKey = resolveHasOneForeignKey(parentModelName, config);
	const ModelClass = instance.constructor;
	const primaryKeyValue = instance._data[ModelClass.primaryKey];

	if (primaryKeyValue == null) return null;

	const RelatedModel = bindModel(config.model(), scopeOf(instance));
	return RelatedModel.findBy({ [foreignKey]: primaryKeyValue });
}

/**
 * Infer join table name from two table names.
 * Sorts alphabetically and joins with underscore.
 * 'posts' + 'tags' -> 'posts_tags'
 * 'categories' + 'posts' -> 'categories_posts'
 */
export function inferJoinTableName(tableName1: string, tableName2: string): string {
	return [tableName1, tableName2].sort().join('_');
}

/**
 * Infer the FK column pointing to a model in a join table.
 * Model 'Post' -> 'postId' (camelCase)
 */
export function inferHABTMForeignKey(modelName: string): string {
	return modelName.charAt(0).toLowerCase() + modelName.slice(1) + 'Id';
}

/**
 * Resolve HABTM configuration with defaults.
 */
export function resolveHABTMConfig(
	ownerModelClass: any,
	config: HasAndBelongsToManyConfig
): {
	joinTable: string;
	foreignKey: string;
	associationForeignKey: string;
} {
	const TargetModel = config.model();
	const joinTable =
		config.joinTable ?? inferJoinTableName(ownerModelClass.tableName, TargetModel.tableName);
	const foreignKey = config.foreignKey ?? inferHABTMForeignKey(ownerModelClass.modelName);
	const associationForeignKey =
		config.associationForeignKey ?? inferHABTMForeignKey(TargetModel.modelName);

	return { joinTable, foreignKey, associationForeignKey };
}

/**
 * Process dependent associations before destroying the owner.
 * Called from Model.destroy() after beforeDestroy hooks.
 *
 * Order of processing:
 *   1. 'restrict' checks (fail fast before any mutations)
 *   2. 'destroy' cascades
 *   3. 'nullify' updates
 */
export async function processDependentAssociations(instance: any): Promise<void> {
	const ModelClass = instance.constructor;
	const pk = ModelClass.primaryKey;
	const ownerPK = instance._data[pk];
	if (ownerPK == null) return;
	const ownerScope = scopeOf(instance);

	// Collect all associations with dependent option
	const dependentAssocs: Array<{
		name: string;
		type: 'hasMany' | 'hasOne';
		config: any;
		dependent: string;
	}> = [];

	if (ModelClass.hasMany) {
		for (const [name, config] of Object.entries(ModelClass.hasMany) as any) {
			if (config.dependent) {
				dependentAssocs.push({ name, type: 'hasMany', config, dependent: config.dependent });
			}
		}
	}
	if (ModelClass.hasOne) {
		for (const [name, config] of Object.entries(ModelClass.hasOne) as any) {
			if (config.dependent) {
				dependentAssocs.push({ name, type: 'hasOne', config, dependent: config.dependent });
			}
		}
	}

	if (dependentAssocs.length === 0) return;

	// Pass 1: Check all 'restrict' associations
	for (const assoc of dependentAssocs) {
		if (assoc.dependent !== 'restrict') continue;

		const fk =
			assoc.type === 'hasMany'
				? resolveHasManyForeignKey(ModelClass.modelName, assoc.config)
				: resolveHasOneForeignKey(ModelClass.modelName, assoc.config);

		const RelatedModel = bindModel(assoc.config.model(), ownerScope);
		const count = await RelatedModel.where({ [fk]: ownerPK }).count();
		if (count > 0) {
			throw new DependentRestrictError(ModelClass.modelName, assoc.name);
		}
	}

	// Pass 2: Process 'destroy' associations
	for (const assoc of dependentAssocs) {
		if (assoc.dependent !== 'destroy') continue;

		const fk =
			assoc.type === 'hasMany'
				? resolveHasManyForeignKey(ModelClass.modelName, assoc.config)
				: resolveHasOneForeignKey(ModelClass.modelName, assoc.config);

		const RelatedModel = bindModel(assoc.config.model(), ownerScope);
		const children = await RelatedModel.where({ [fk]: ownerPK }).all();

		// Destroy each child (triggers THEIR dependent processing recursively)
		for (const child of children) {
			await child.destroy();
		}
	}

	// Pass 3: Process 'nullify' associations
	for (const assoc of dependentAssocs) {
		if (assoc.dependent !== 'nullify') continue;

		const fk =
			assoc.type === 'hasMany'
				? resolveHasManyForeignKey(ModelClass.modelName, assoc.config)
				: resolveHasOneForeignKey(ModelClass.modelName, assoc.config);

		const RelatedModel = bindModel(assoc.config.model(), ownerScope);
		// Batch update: SET fk = NULL WHERE fk = ownerPK
		const db = requireScope(ownerScope).session();
		await db.execute(
			sql`UPDATE ${sql.raw(RelatedModel.tableName)}
          SET ${sql.raw(toSnakeCase(fk))} = NULL
          WHERE ${sql.raw(toSnakeCase(fk))} = ${ownerPK}`
		);
	}
}
