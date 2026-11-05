export { Model, createActiveRecordJS } from './model';
export { QueryBuilder } from './query-builder';
export { createConnection, setGlobalConnection } from './connection';
export * from './errors';
export type * from './types';
export { CollectionProxy } from './collection-proxy';
export { HABTMCollectionProxy } from './habtm-collection-proxy';
export {
	loadBelongsTo,
	loadHasOne,
	resolveHasManyForeignKey,
	resolveHasOneForeignKey,
	resolveBelongsToForeignKey,
	toSnakeCase,
	inferJoinTableName,
	inferHABTMForeignKey,
	resolveHABTMConfig
} from './associations';
export { eagerLoad } from './eager-loader';

// Re-export Zod for convenience
export { z } from 'zod';
