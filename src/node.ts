/**
 * Node entry: the ambient binding. AsyncLocalStorage plus a node-entry default.
 *
 * Core never imports this module. Loading it installs the reader that core
 * consults for work that has no captured scope. Captured scope (a model from
 * `scope.model`, a builder, an instance, an association) always wins over it.
 *
 * This entry does not load a driver. Pass any Drizzle Postgres session (for
 * example from the `postgres-js` entry) or a ConnectionScope.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { Model } from './model';
import { createScope } from './scope';
import {
	installAmbientScopeProvider,
	requireScope,
	type ConnectionScope,
	type PgSession
} from './session';

export type SessionOrScope = PgSession | ConnectionScope;

const context = new AsyncLocalStorage<ConnectionScope>();
let nodeDefault: ConnectionScope | null = null;

// One root scope per session, so root identity (transaction exclusion) is stable.
const rootScopes = new WeakMap<object, ConnectionScope>();

function isScope(value: unknown): value is ConnectionScope {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as any).session === 'function' &&
		typeof (value as any).model === 'function' &&
		'lease' in value
	);
}

/** The root scope for a session (created once), or the scope itself. */
export function toScope(db: SessionOrScope): ConnectionScope {
	if (isScope(db)) return db;
	let scope = rootScopes.get(db as object);
	if (!scope) {
		scope = createScope(db as PgSession);
		rootScopes.set(db as object, scope);
	}
	return scope;
}

installAmbientScopeProvider({
	current: () => context.getStore(),
	fallback: () => nodeDefault ?? undefined,
	runWith: (scope, fn) => context.run(scope, fn)
});

/**
 * Replace the node default scope. Used for setup and tests. It does not write
 * a session into core.
 */
export function setGlobalConnection(db: SessionOrScope): void {
	nodeDefault = toScope(db);
}

/**
 * The session the current context resolves to (context store, else node
 * default). Throws when neither is bound. Kept for harness code.
 */
export function getGlobalConnection(): PgSession {
	return requireScope(null).session();
}

/**
 * Bind db for fn's async context. The previous store (including none, which
 * falls back to the node default) is back in effect when fn returns.
 */
export function runWithConnection<T>(db: SessionOrScope, fn: () => T): T {
	return context.run(toScope(db), fn);
}

/** Store db as the node default and return the model factory. */
export function createActiveRecordJS(db: SessionOrScope): { Model: typeof Model } {
	setGlobalConnection(db);
	return { Model };
}
