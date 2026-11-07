/**
 * PGlite entry: one official PGlite database, one root ConnectionScope, one
 * exclusive lease on its single session.
 *
 * Does not load the node entry or the postgres-js entry.
 *
 * PGlite serialization, confirmed (PGlite 0.5, probed with concurrent calls):
 * the client already runs one statement at a time. Concurrent `query` calls
 * run in call order, a `query` issued while a `transaction` is open waits for
 * it to settle, and a second `transaction` waits for the first. That queue is
 * unbounded, has no timeout, and has no notion of who owns the transaction.
 * So the lease below stays the transaction owner and adds the bounded wait,
 * the rollback on timeout, and the holder bypass. It does not add a second
 * statement queue: autocommit work takes the lease for one statement, then
 * hands the statement to PGlite's own queue.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
	ActiveRecordJSError,
	ScopeClosedError,
	TransactionReentryError
} from './errors';
import { Model } from './model';
import { DEFAULT_LEASE_TIMEOUT_MS, LeaseTimeoutError, SessionLease } from './pglite-lease';
import { createScope } from './scope';
import {
	bindModel,
	captureScope,
	runWithAmbient,
	type BoundModel,
	type ConnectionScope,
	type LeaseToken,
	type PgSession
} from './session';

export { DEFAULT_LEASE_TIMEOUT_MS, LeaseTimeoutError };

/** SET, temporary tables, or advisory locks on the PGlite adapter. */
export class PgliteSessionStateError extends ActiveRecordJSError {
	constructor(what: string) {
		super(
			`PGlite adapter rejects ${what}: the single session is shared, so session state would leak between callers. Use SET LOCAL inside a transaction.`
		);
		this.name = 'PgliteSessionStateError';
	}
}

/** Drop comments and string/dollar-quoted literals so keywords inside them do not match. */
function stripLiterals(sql: string): string {
	return sql
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/--[^\n]*/g, ' ')
		.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, "''")
		.replace(/'(?:[^']|'')*'/g, "''")
		.replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * Throws before a statement reaches the session when it would change session
 * state. A text guard over the statement, not a SQL parser. `SET LOCAL` and
 * transaction-scoped `set_config(..., true)` pass.
 */
export function assertSessionSafe(sql: string): void {
	const text = stripLiterals(sql);
	for (const part of text.split(';')) {
		const statement = part.replace(/^[\s(]+/, '');
		if (/^SET\s+LOCAL\b/i.test(statement)) continue;
		if (/^SET\b/i.test(statement)) throw new PgliteSessionStateError('SET');
		if (/^RESET\b/i.test(statement)) throw new PgliteSessionStateError('RESET');
		if (/^CREATE\s+(?:GLOBAL\s+|LOCAL\s+)?TEMP(?:ORARY)?\b/i.test(statement)) {
			throw new PgliteSessionStateError('temporary tables');
		}
		if (/\bINTO\s+(?:GLOBAL\s+|LOCAL\s+)?TEMP(?:ORARY)?\b/i.test(statement)) {
			throw new PgliteSessionStateError('temporary tables');
		}
	}
	if (/\bpg_(?:try_)?advisory_/i.test(text)) throw new PgliteSessionStateError('advisory locks');
	for (const call of text.matchAll(/\bset_config\s*\(([^;]*)/gi)) {
		if (!/,\s*true\s*\)/i.test(call[1])) throw new PgliteSessionStateError('session-level set_config');
	}
}

/** Forward everything to target, bound to it (PGlite keeps private state on `this`). */
function forwarding<T extends object>(target: T, overrides: Record<string, unknown>): T {
	return new Proxy(target, {
		get(_, prop) {
			if (typeof prop === 'string' && prop in overrides) return overrides[prop];
			const value = Reflect.get(target, prop, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}

/** A transaction handle whose statements are checked. It never touches the lease queue. */
function guardedTransaction<T extends { query: any; exec: any }>(tx: T): T {
	return forwarding(tx, {
		query: (sql: string, ...rest: unknown[]) => {
			assertSessionSafe(sql);
			return tx.query(sql, ...rest);
		},
		exec: (sql: string, ...rest: unknown[]) => {
			assertSessionSafe(sql);
			return tx.exec(sql, ...rest);
		}
	});
}

/**
 * The client Drizzle talks to. Autocommit statements (`query`, `exec` on the
 * client) take the lease for the statement and wait while it is held.
 * Transaction statements run on the `tx` handle PGlite passes to the callback,
 * which is the holder's own path, so they do not wait. `transaction` itself is
 * not gated here: `PgliteScope.transaction` queues first and then enters.
 */
function leasedClient(raw: PGlite, lease: SessionLease): PGlite {
	const autocommit =
		(method: 'query' | 'exec') =>
		async (sql: string, ...rest: unknown[]) => {
			assertSessionSafe(sql);
			const grant = await lease.acquire('autocommit');
			try {
				return await (raw[method] as any)(sql, ...rest);
			} finally {
				grant.release();
			}
		};
	return forwarding(raw, {
		query: autocommit('query'),
		exec: autocommit('exec'),
		transaction: (callback: (tx: any) => Promise<unknown>) =>
			raw.transaction((tx) => callback(guardedTransaction(tx as any)))
	});
}

/**
 * The scope `openPglite` returns: a lease gate in front of one root scope.
 *
 * - `transaction` waits for the lease, then runs on the root, so the callback
 *   gets the root's callback scope with its live `LeaseToken`. Statements on
 *   that scope run at once; they never queue behind the next waiter.
 * - Autocommit statements wait per statement in the leased client.
 * - A nested `transaction` on the callback scope throws in the root. A call on
 *   this gate from inside the holder's own async context (visible when the
 *   node entry's ambient binding is installed) throws here, not waits.
 */
class PgliteScope implements ConnectionScope {
	readonly #root: ConnectionScope;
	readonly #lease: SessionLease;
	readonly #models = new WeakMap<object, any>();
	#holder: LeaseToken | null = null;
	#closed = false;
	#closing: Promise<void> | null = null;

	constructor(root: ConnectionScope, lease: SessionLease) {
		this.#root = root;
		this.#lease = lease;
	}

	get lease(): LeaseToken | null {
		return null;
	}

	get closed(): boolean {
		return this.#closed || this.#root.closed;
	}

	session(): PgSession {
		return this.#root.session();
	}

	run<R>(fn: (scope: ConnectionScope) => R): R {
		return runWithAmbient(this, () => fn(this));
	}

	async transaction<R>(fn: (scope: ConnectionScope) => Promise<R>): Promise<R> {
		if (this.closed) throw new ScopeClosedError('scope is closed');
		const ambient = captureScope(null);
		if (ambient?.lease && ambient.lease.live && ambient.lease === this.#holder) {
			throw new TransactionReentryError('transaction called from inside this root’s open transaction');
		}

		const grant = await this.#lease.acquire('transaction');
		let abort!: (reason: Error) => void;
		const aborted = new Promise<never>((_, reject) => {
			abort = reject;
		});
		aborted.catch(() => {});
		grant.onAbort(abort);

		try {
			if (this.closed) throw new ScopeClosedError('scope is closed');
			return await this.#root.transaction(async (tx) => {
				this.#holder = tx.lease;
				try {
					return await Promise.race([fn(tx), aborted]);
				} finally {
					this.#holder = null;
				}
			});
		} finally {
			// The root has rolled back or committed and retired the token by now.
			grant.release();
		}
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		this.#lease.close();
		this.#closing = this.#root.close();
		return this.#closing;
	}

	model(tableOrModel: any): any {
		let bound = this.#models.get(tableOrModel);
		if (!bound) {
			const isModelClass = typeof tableOrModel === 'function' && 'connectionScope' in tableOrModel;
			bound = isModelClass ? bindModel(tableOrModel, this) : Model(tableOrModel as PgTable, this);
			this.#models.set(tableOrModel, bound);
		}
		return bound as BoundModel<any>;
	}
}

export interface OpenPgliteOptions {
	/** Directory to persist in. Omit for a memory database. */
	dataDir?: string;
	/** Lease wait in milliseconds. Default 5000. */
	leaseTimeoutMs?: number;
}

/**
 * Open one PGlite database and return its scope. `close()` rolls back an open
 * transaction, rejects waiters, and closes the database (a directory is
 * flushed, so the next `openPglite` on it sees the committed rows).
 */
export async function openPglite(options: OpenPgliteOptions = {}): Promise<ConnectionScope> {
	const raw = options.dataDir ? new PGlite(options.dataDir) : new PGlite();
	await raw.waitReady;
	const lease = new SessionLease(options.leaseTimeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS);
	const db = drizzle({ client: leasedClient(raw, lease) });
	const root = createScope(db, { close: () => raw.close() });
	return new PgliteScope(root, lease);
}
