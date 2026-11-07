/**
 * The core ConnectionScope over any Drizzle PgDatabase. Driver-agnostic:
 * adapters (postgres-js, later PGlite) hand it a session and a closer.
 */
import type { PgTable } from 'drizzle-orm/pg-core';
import { ScopeClosedError, TransactionReentryError } from './errors';
import { Model } from './model';
import {
	bindModel,
	LeaseToken,
	runWithAmbient,
	type BoundModel,
	type ConnectionScope,
	type PgSession
} from './session';

export interface CreateScopeOptions {
	/** Closes the client this root owns. Called by root close() after any open transaction settles. */
	close?: () => void | Promise<void>;
}

interface ActiveTransaction {
	token: LeaseToken;
	abort: (reason: Error) => void;
	settled: Promise<void>;
}

class SessionScope implements ConnectionScope {
	readonly #session: PgSession;
	readonly #root: SessionScope | null;
	readonly #lease: LeaseToken | null;
	readonly #closer: (() => void | Promise<void>) | undefined;
	readonly #models = new WeakMap<object, any>();
	#closed = false;
	#closing: Promise<void> | null = null;
	#active: ActiveTransaction | null = null;

	constructor(
		session: PgSession,
		opts: { root?: SessionScope; lease?: LeaseToken; close?: () => void | Promise<void> } = {}
	) {
		this.#session = session;
		this.#root = opts.root ?? null;
		this.#lease = opts.lease ?? null;
		this.#closer = opts.close;
	}

	get lease(): LeaseToken | null {
		return this.#lease;
	}

	get closed(): boolean {
		return this.#closed || (this.#root?.closed ?? false);
	}

	#assertUsable(): void {
		if (this.#closed) throw new ScopeClosedError('scope is closed');
		if (this.#root?.closed) throw new ScopeClosedError('root scope is closed');
		if (this.#lease && !this.#lease.live) {
			throw new ScopeClosedError('transaction lease retired');
		}
	}

	session(): PgSession {
		this.#assertUsable();
		return this.#session;
	}

	run<R>(fn: (scope: ConnectionScope) => R): R {
		return runWithAmbient(this, () => fn(this));
	}

	async transaction<R>(fn: (scope: ConnectionScope) => Promise<R>): Promise<R> {
		this.#assertUsable();
		if (this.#lease) throw new TransactionReentryError('transaction called on a callback scope');
		if (this.#active) throw new TransactionReentryError('this root already has a transaction open');

		const token = new LeaseToken();
		let abort!: (reason: Error) => void;
		const aborted = new Promise<never>((_, reject) => {
			abort = reject;
		});
		aborted.catch(() => {});

		let resolveSettled!: () => void;
		const active: ActiveTransaction = {
			token,
			abort,
			settled: new Promise<void>((resolve) => {
				resolveSettled = resolve;
			})
		};
		this.#active = active;

		try {
			return await this.#session.transaction(async (tx) => {
				const child = new SessionScope(tx as PgSession, { root: this, lease: token });
				return await Promise.race([runWithAmbient(child, () => fn(child)), aborted]);
			});
		} finally {
			token.retire();
			if (this.#active === active) this.#active = null;
			resolveSettled();
		}
	}

	close(): Promise<void> {
		if (this.#lease) {
			// Child: reject further callback work. The root client stays open.
			this.#closed = true;
			return Promise.resolve();
		}
		if (this.#closing) return this.#closing;
		this.#closed = true;
		this.#closing = (async () => {
			const active = this.#active;
			if (active) {
				// Roll back the open transaction, wait for the token to retire, then close.
				active.abort(new ScopeClosedError('root closed during transaction'));
				await active.settled;
			}
			await this.#closer?.();
		})();
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

/** Open a root scope over a Drizzle Postgres session. */
export function createScope(session: PgSession, options: CreateScopeOptions = {}): ConnectionScope {
	return new SessionScope(session, { close: options.close });
}
