/**
 * The exclusive lease on one PGlite session. No PGlite import, no Node builtin.
 *
 * One holder at a time. Everyone else waits in FIFO order, each with its own
 * bounded wait. A holder never passes through this queue again: a transaction
 * holds the lease from begin to settle, and its callback scope runs on the
 * transaction session directly (the live `LeaseToken` is the proof), so the
 * statements inside it do not call `acquire`.
 */
import { ActiveRecordJSError, ScopeClosedError } from './errors';

export const DEFAULT_LEASE_TIMEOUT_MS = 5000;

export type LeaseKind = 'transaction' | 'autocommit';

/** A wait for the PGlite lease exceeded its limit. */
export class LeaseTimeoutError extends ActiveRecordJSError {
	constructor(
		readonly timeoutMs: number,
		readonly heldBy: LeaseKind | null
	) {
		super(
			`PGlite lease wait timed out after ${timeoutMs}ms` +
				(heldBy === 'transaction'
					? '; the open transaction was rolled back and the lease released'
					: heldBy === 'autocommit'
						? '; an autocommit statement still holds the lease'
						: '')
		);
		this.name = 'LeaseTimeoutError';
	}
}

export interface LeaseGrant {
	readonly kind: LeaseKind;
	/**
	 * Register how to abort the work this grant covers. Called at most once per
	 * timed-out waiter. Only a transaction grant has anything to abort.
	 */
	onAbort(abort: (reason: Error) => void): void;
	/** Give the lease to the next waiter. Idempotent. */
	release(): void;
}

interface Waiter {
	kind: LeaseKind;
	resolve: (grant: LeaseGrant) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

interface Holder {
	kind: LeaseKind;
	abort: ((reason: Error) => void) | null;
}

export class SessionLease {
	readonly timeoutMs: number;
	#holder: Holder | null = null;
	#queue: Waiter[] = [];
	#closed = false;

	constructor(timeoutMs: number = DEFAULT_LEASE_TIMEOUT_MS) {
		if (!(timeoutMs > 0)) throw new RangeError('lease timeout must be a positive number of milliseconds');
		this.timeoutMs = timeoutMs;
	}

	/** True while a holder has the lease. */
	get held(): boolean {
		return this.#holder !== null;
	}

	/** How many callers are waiting. */
	get waiting(): number {
		return this.#queue.length;
	}

	/**
	 * Take the lease, or wait for it. Rejects with `LeaseTimeoutError` when the
	 * wait exceeds the limit; if a transaction holds the lease at that moment it
	 * is aborted (the caller rolls it back and then releases).
	 */
	acquire(kind: LeaseKind): Promise<LeaseGrant> {
		if (this.#closed) return Promise.reject(new ScopeClosedError('scope is closed'));
		if (!this.#holder && this.#queue.length === 0) return Promise.resolve(this.#grant(kind));
		return new Promise<LeaseGrant>((resolve, reject) => {
			const waiter: Waiter = {
				kind,
				resolve,
				reject,
				timer: setTimeout(() => this.#expire(waiter), this.timeoutMs)
			};
			this.#queue.push(waiter);
		});
	}

	/** Reject every waiter. The holder is not touched; the owner aborts it. */
	close(reason: Error = new ScopeClosedError('scope closed while waiting for the lease')): void {
		this.#closed = true;
		const waiters = this.#queue.splice(0);
		for (const waiter of waiters) {
			clearTimeout(waiter.timer);
			waiter.reject(reason);
		}
	}

	#grant(kind: LeaseKind): LeaseGrant {
		const holder: Holder = { kind, abort: null };
		this.#holder = holder;
		let released = false;
		return {
			kind,
			onAbort: (abort) => {
				holder.abort = abort;
			},
			release: () => {
				if (released) return;
				released = true;
				if (this.#holder === holder) {
					this.#holder = null;
					this.#next();
				}
			}
		};
	}

	#next(): void {
		if (this.#holder) return;
		const waiter = this.#queue.shift();
		if (!waiter) return;
		clearTimeout(waiter.timer);
		waiter.resolve(this.#grant(waiter.kind));
	}

	#expire(waiter: Waiter): void {
		const index = this.#queue.indexOf(waiter);
		if (index === -1) return;
		this.#queue.splice(index, 1);
		const holder = this.#holder;
		const error = new LeaseTimeoutError(this.timeoutMs, holder?.kind ?? null);
		waiter.reject(error);
		// An open transaction rolls back. An autocommit statement cannot be recalled.
		if (holder?.kind === 'transaction') holder.abort?.(error);
	}
}
