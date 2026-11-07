/**
 * Core session seam. No driver, no Node builtin.
 *
 * - `PgSession` is the one session type models and builders see: Drizzle's `PgDatabase`.
 * - `ConnectionScope` is the explicit handle work is created with and keeps.
 * - The ambient provider is installed by the node entry. Core holds no session of its own.
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import { NoConnectionScopeError } from './errors';
import type { Model } from './model';

/** The shared session surface. Driver client types stay inside their adapter. */
export type PgSession = PgDatabase<PgQueryResultHKT, any, any>;

/** A model class bound to a scope (or unbound, resolving the ambient scope). */
export type BoundModel<T extends PgTable> = ReturnType<typeof Model<T>>;

/**
 * Proof that a scope owns an open transaction. Live from begin until the
 * transaction settles (commit, rollback, or a failed completion).
 */
export class LeaseToken {
	readonly id = Symbol('lease');
	#live = true;

	get live(): boolean {
		return this.#live;
	}

	/** @internal */
	retire(): void {
		this.#live = false;
	}
}

export interface ConnectionScope {
	/** Present only on a transaction callback scope. */
	readonly lease: LeaseToken | null;
	/** True after close() on this scope (or on its root). */
	readonly closed: boolean;
	/**
	 * The session to issue a statement on. Throws before returning when the
	 * scope is closed or its lease retired, so no driver method runs.
	 */
	session(): PgSession;
	/** Call fn with this scope. Does not retarget a model bound to another scope. */
	run<R>(fn: (scope: ConnectionScope) => R): R;
	/** Begin a driver transaction; fn receives a callback scope on the transaction session. */
	transaction<R>(fn: (scope: ConnectionScope) => Promise<R>): Promise<R>;
	/** Reject further work on this scope. A root also rolls back an open transaction and closes its client. */
	close(): Promise<void>;
	/** A model class closed over this scope. Accepts a table, or an existing model class to rebind. */
	model<T extends PgTable>(table: T): BoundModel<T>;
	model<M extends { table: PgTable; connectionScope: ConnectionScope | null }>(modelClass: M): M;
}

/**
 * Installed by the node entry (AsyncLocalStorage + node default). Core never
 * imports it; core only reads it when work has no captured scope.
 */
export interface AmbientScopeProvider {
	/** The scope bound for the current async context, if any. */
	current(): ConnectionScope | undefined;
	/** The node-entry default, if any. */
	fallback(): ConnectionScope | undefined;
	/** Run fn with scope bound as the current context. */
	runWith<R>(scope: ConnectionScope, fn: () => R): R;
}

let provider: AmbientScopeProvider | null = null;

/** @internal Used by the node entry. */
export function installAmbientScopeProvider(next: AmbientScopeProvider | null): void {
	provider = next;
}

/**
 * The scope work should keep when it is created: the explicit scope, else the
 * context-bound ambient scope. The node default is not captured; uncaptured
 * work resolves it when it runs.
 */
export function captureScope(explicit?: ConnectionScope | null): ConnectionScope | null {
	return explicit ?? provider?.current() ?? null;
}

/** Resolve the scope to run on now, or throw before any driver call. */
export function requireScope(captured?: ConnectionScope | null): ConnectionScope {
	const scope = captured ?? provider?.current() ?? provider?.fallback();
	if (!scope) throw new NoConnectionScopeError();
	return scope;
}

/** @internal Bind scope for fn in the ambient context when a provider is installed. */
export function runWithAmbient<R>(scope: ConnectionScope, fn: () => R): R {
	return provider ? provider.runWith(scope, fn) : fn();
}

/** The scope an instance should run on: its own captured scope, else its class's. */
export function scopeOf(instance: any): ConnectionScope | null {
	return instance?._scope ?? instance?.constructor?.connectionScope ?? null;
}

const boundCache = new WeakMap<ConnectionScope, WeakMap<object, any>>();

/**
 * A subclass of modelClass bound to scope. Used so related-model lookups run
 * on the owner's scope. Returns modelClass unchanged when scope is null.
 */
export function bindModel<M>(modelClass: M, scope: ConnectionScope | null): M {
	if (!scope || !modelClass) return modelClass;
	const base = modelClass as any;
	if (base.connectionScope === scope) return modelClass;
	let perScope = boundCache.get(scope);
	if (!perScope) {
		perScope = new WeakMap();
		boundCache.set(scope, perScope);
	}
	let bound = perScope.get(base);
	if (!bound) {
		bound = class extends base {
			static connectionScope = scope;
		};
		Object.defineProperty(bound, 'name', { value: base.name });
		perScope.set(base, bound);
	}
	return bound as M;
}
