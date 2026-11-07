// Core entry. No Node builtin, no driver. Drivers live on the `postgres-js`
// entry; the Node ambient binding lives on the `node` entry.
export { Model } from './model';
export { QueryBuilder } from './query-builder';
export { createScope, type CreateScopeOptions } from './scope';
export { LeaseToken, type ConnectionScope, type PgSession, type BoundModel } from './session';
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
