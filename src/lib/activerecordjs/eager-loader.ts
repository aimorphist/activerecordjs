import { sql } from 'drizzle-orm';
import {
	resolveHasManyForeignKey,
	resolveHasOneForeignKey,
	resolveBelongsToForeignKey,
	resolveHABTMConfig,
	toSnakeCase
} from './associations';
import { getGlobalConnection } from './connection';

/**
 * EagerLoader batches association loading to prevent N+1 queries.
 *
 * Strategy: Separate queries (not JOINs).
 *   1. Load main records
 *   2. Collect IDs from main records
 *   3. For each included association, run ONE query with WHERE ... IN (ids)
 *   4. Distribute loaded records back to their owners via _associations cache
 */
export async function eagerLoad(
	records: any[],
	associations: string[],
	modelClass: any
): Promise<void> {
	if (records.length === 0 || associations.length === 0) return;

	for (const assocName of associations) {
		if (modelClass.hasMany && assocName in modelClass.hasMany) {
			const config = modelClass.hasMany[assocName];
			if (config.through) {
				await eagerLoadThrough(records, assocName, modelClass);
			} else {
				await eagerLoadHasMany(records, assocName, modelClass);
			}
		} else if (modelClass.belongsTo && assocName in modelClass.belongsTo) {
			await eagerLoadBelongsTo(records, assocName, modelClass);
		} else if (modelClass.hasOne && assocName in modelClass.hasOne) {
			await eagerLoadHasOne(records, assocName, modelClass);
		} else if (modelClass.hasAndBelongsToMany && assocName in modelClass.hasAndBelongsToMany) {
			// HABTM will be added in Phase 3
			await eagerLoadHABTM(records, assocName, modelClass);
		} else {
			throw new Error(`Unknown association '${assocName}' on ${modelClass.modelName}`);
		}
	}
}

async function eagerLoadHasMany(records: any[], assocName: string, modelClass: any) {
	const config = modelClass.hasMany[assocName];
	const foreignKey = resolveHasManyForeignKey(modelClass.modelName, config);
	const pk = modelClass.primaryKey;

	// Collect owner IDs
	const ownerIds = records.map((r: any) => r._data[pk]).filter((id: any) => id != null);
	if (ownerIds.length === 0) return;

	// Batch load
	const RelatedModel = config.model();
	const allRelated = await RelatedModel.where({}).whereIn(foreignKey, ownerIds).all();

	// Distribute to owners
	const grouped = new Map<unknown, any[]>();
	for (const record of allRelated) {
		const fkValue = record._data[foreignKey];
		if (!grouped.has(fkValue)) grouped.set(fkValue, []);
		grouped.get(fkValue)!.push(record);
	}

	for (const owner of records) {
		const ownerId = owner._data[pk];
		owner._associations[assocName] = grouped.get(ownerId) ?? [];
	}
}

async function eagerLoadBelongsTo(records: any[], assocName: string, modelClass: any) {
	const config = modelClass.belongsTo[assocName];
	const foreignKey = resolveBelongsToForeignKey(assocName, config);

	// Collect FK values (deduplicate)
	const fkValues = [
		...new Set(records.map((r: any) => r._data[foreignKey]).filter((v: any) => v != null))
	];
	if (fkValues.length === 0) {
		// Set all to null
		for (const record of records) {
			record._associations[assocName] = null;
		}
		return;
	}

	// Batch load by primary key of related model
	const RelatedModel = config.model();
	const relatedPk = RelatedModel.primaryKey;
	const allRelated = await RelatedModel.where({}).whereIn(relatedPk, fkValues).all();

	// Index by PK
	const indexed = new Map<unknown, any>();
	for (const record of allRelated) {
		indexed.set(record._data[relatedPk], record);
	}

	for (const record of records) {
		const fkValue = record._data[foreignKey];
		record._associations[assocName] = indexed.get(fkValue) ?? null;
	}
}

async function eagerLoadHasOne(records: any[], assocName: string, modelClass: any) {
	const config = modelClass.hasOne[assocName];
	const foreignKey = resolveHasOneForeignKey(modelClass.modelName, config);
	const pk = modelClass.primaryKey;

	// Collect owner IDs
	const ownerIds = records.map((r: any) => r._data[pk]).filter((id: any) => id != null);
	if (ownerIds.length === 0) return;

	// Batch load
	const RelatedModel = config.model();
	const allRelated = await RelatedModel.where({}).whereIn(foreignKey, ownerIds).all();

	// Index by FK (take first match for each owner)
	const indexed = new Map<unknown, any>();
	for (const record of allRelated) {
		const fkValue = record._data[foreignKey];
		if (!indexed.has(fkValue)) {
			indexed.set(fkValue, record);
		}
	}

	for (const owner of records) {
		const ownerId = owner._data[pk];
		owner._associations[assocName] = indexed.get(ownerId) ?? null;
	}
}

async function eagerLoadThrough(records: any[], assocName: string, modelClass: any) {
	const config = modelClass.hasMany[assocName];
	const throughAssocName = config.through;
	const throughConfig = modelClass.hasMany[throughAssocName];
	const pk = modelClass.primaryKey;

	// Step 1: Collect owner IDs
	const ownerIds = records.map((r: any) => r._data[pk]).filter((id: any) => id != null);
	if (ownerIds.length === 0) return;

	// Step 2: Batch load intermediaries
	const ThroughModel = throughConfig.model();
	const throughFK = resolveHasManyForeignKey(modelClass.modelName, throughConfig);
	const intermediaries = await ThroughModel.where({}).whereIn(throughFK, ownerIds).all();

	if (intermediaries.length === 0) {
		for (const owner of records) {
			owner._associations[assocName] = [];
		}
		return;
	}

	// Step 3: Batch load targets
	const intermediaryIds = intermediaries.map((r: any) => r._data[ThroughModel.primaryKey]);
	const TargetModel = config.model();
	const targetFK = resolveHasManyForeignKey(ThroughModel.modelName, config);
	const targets = await TargetModel.where({}).whereIn(targetFK, intermediaryIds).all();

	// Step 4: Build owner -> intermediaryIds -> targetRecords mapping
	// Group intermediaries by owner FK
	const intermediariesByOwner = new Map<unknown, any[]>();
	for (const inter of intermediaries) {
		const ownerId = inter._data[throughFK];
		if (!intermediariesByOwner.has(ownerId)) intermediariesByOwner.set(ownerId, []);
		intermediariesByOwner.get(ownerId)!.push(inter);
	}

	// Group targets by intermediary FK
	const targetsByIntermediary = new Map<unknown, any[]>();
	for (const target of targets) {
		const interId = target._data[targetFK];
		if (!targetsByIntermediary.has(interId)) targetsByIntermediary.set(interId, []);
		targetsByIntermediary.get(interId)!.push(target);
	}

	// Distribute to owners
	for (const owner of records) {
		const ownerId = owner._data[pk];
		const ownerIntermediaries = intermediariesByOwner.get(ownerId) ?? [];
		const ownerTargets: any[] = [];
		for (const inter of ownerIntermediaries) {
			const interId = inter._data[ThroughModel.primaryKey];
			const matched = targetsByIntermediary.get(interId) ?? [];
			ownerTargets.push(...matched);
		}
		owner._associations[assocName] = ownerTargets;
	}
}

/**
 * Eager load HABTM associations via join table.
 * Uses two batch queries: one for the join table, one for target records.
 */
async function eagerLoadHABTM(records: any[], assocName: string, modelClass: any) {
	const config = modelClass.hasAndBelongsToMany[assocName];
	const resolved = resolveHABTMConfig(modelClass, config);
	const pk = modelClass.primaryKey;

	// Collect owner IDs
	const ownerIds = records.map((r: any) => r._data[pk]).filter((id: any) => id != null);
	if (ownerIds.length === 0) return;

	// Batch query join table using drizzle sql template
	const db = getGlobalConnection();
	const fkCol = toSnakeCase(resolved.foreignKey);
	const assocFkCol = toSnakeCase(resolved.associationForeignKey);

	// Use sql template to safely parameterize the IN clause
	const idList = ownerIds.map((id: any) => sql`${id}`).reduce((a: any, b: any) => sql`${a}, ${b}`);
	const joinRows = await db.execute(
		sql`SELECT ${sql.raw(fkCol)}, ${sql.raw(assocFkCol)} FROM ${sql.raw(resolved.joinTable)} WHERE ${sql.raw(fkCol)} IN (${idList})`
	);

	// Collect target IDs from join rows
	const allTargetIds = [...new Set((joinRows as any[]).map((r: any) => r[assocFkCol]))];
	if (allTargetIds.length === 0) {
		// No associations - set empty arrays
		for (const owner of records) {
			owner._associations[assocName] = [];
		}
		return;
	}

	// Batch load target records
	const TargetModel = config.model();
	const targets = await TargetModel.where({}).whereIn(TargetModel.primaryKey, allTargetIds).all();

	// Index targets by PK
	const targetsByPK = new Map<unknown, any>();
	for (const target of targets) {
		targetsByPK.set(target._data[TargetModel.primaryKey], target);
	}

	// Group join rows by owner FK
	const targetIdsByOwner = new Map<unknown, any[]>();
	for (const row of joinRows as any[]) {
		const ownerId = row[fkCol];
		if (!targetIdsByOwner.has(ownerId)) targetIdsByOwner.set(ownerId, []);
		targetIdsByOwner.get(ownerId)!.push(row[assocFkCol]);
	}

	// Distribute to owners
	for (const owner of records) {
		const ownerId = owner._data[pk];
		const targetIds = targetIdsByOwner.get(ownerId) ?? [];
		owner._associations[assocName] = targetIds
			.map((id: any) => targetsByPK.get(id))
			.filter(Boolean);
	}
}
