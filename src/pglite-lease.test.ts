/**
 * The PGlite lease queue on fake timers. No PGlite, no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScopeClosedError } from './errors';
import { DEFAULT_LEASE_TIMEOUT_MS, LeaseTimeoutError, SessionLease } from './pglite-lease';

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('SessionLease', () => {
	it('defaults the wait to 5 seconds', () => {
		expect(DEFAULT_LEASE_TIMEOUT_MS).toBe(5000);
		expect(new SessionLease().timeoutMs).toBe(5000);
	});

	it('grants at once when free and hands over in FIFO order on release', async () => {
		const lease = new SessionLease();
		const order: string[] = [];
		const first = await lease.acquire('transaction');
		const second = lease.acquire('transaction').then((g) => (order.push('second'), g));
		const third = lease.acquire('autocommit').then((g) => (order.push('third'), g));
		await vi.advanceTimersByTimeAsync(10);
		expect(order).toEqual([]);
		expect(lease.waiting).toBe(2);

		first.release();
		const secondGrant = await second;
		expect(order).toEqual(['second']);
		secondGrant.release();
		await third;
		expect(order).toEqual(['second', 'third']);
	});

	it('a second release is a no-op and does not skip a waiter', async () => {
		const lease = new SessionLease();
		const first = await lease.acquire('transaction');
		const second = lease.acquire('transaction');
		const third = lease.acquire('transaction');
		first.release();
		first.release();
		const g2 = await second;
		expect(lease.waiting).toBe(1);
		g2.release();
		await third;
	});

	it('times out a waiter at the limit, names the timeout, and aborts the open transaction', async () => {
		const lease = new SessionLease(5000);
		const holder = await lease.acquire('transaction');
		const abort = vi.fn();
		holder.onAbort(abort);

		const waiter = lease.acquire('transaction');
		const outcome = waiter.then(
			() => null,
			(e) => e
		);
		await vi.advanceTimersByTimeAsync(4999);
		expect(abort).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);

		const error = await outcome;
		expect(error).toBeInstanceOf(LeaseTimeoutError);
		expect(error.message).toMatch(/timed out after 5000ms/);
		expect(error.message).toMatch(/rolled back/);
		expect(abort).toHaveBeenCalledTimes(1);
		expect(abort.mock.calls[0][0]).toBe(error);
		expect(lease.waiting).toBe(0);

		// The owner rolls back, then releases; the next caller enters.
		holder.release();
		const next = await lease.acquire('autocommit');
		next.release();
		expect(lease.held).toBe(false);
	});

	it('does not abort an autocommit holder, only fails the waiter', async () => {
		const lease = new SessionLease(100);
		const holder = await lease.acquire('autocommit');
		const abort = vi.fn();
		holder.onAbort(abort);
		const outcome = lease.acquire('transaction').then(
			() => null,
			(e) => e
		);
		await vi.advanceTimersByTimeAsync(100);
		expect(await outcome).toBeInstanceOf(LeaseTimeoutError);
		expect(abort).not.toHaveBeenCalled();
		expect(lease.held).toBe(true);
		holder.release();
	});

	it('a waiter that is granted before its limit never times out', async () => {
		const lease = new SessionLease(100);
		const holder = await lease.acquire('transaction');
		const abort = vi.fn();
		holder.onAbort(abort);
		const waiter = lease.acquire('transaction');
		await vi.advanceTimersByTimeAsync(50);
		holder.release();
		const grant = await waiter;
		await vi.advanceTimersByTimeAsync(500);
		expect(abort).not.toHaveBeenCalled();
		grant.release();
	});

	it('close rejects waiters and refuses new acquires', async () => {
		const lease = new SessionLease();
		const holder = await lease.acquire('transaction');
		const waiter = lease.acquire('transaction').then(
			() => null,
			(e) => e
		);
		lease.close();
		expect(await waiter).toBeInstanceOf(ScopeClosedError);
		await expect(lease.acquire('autocommit')).rejects.toBeInstanceOf(ScopeClosedError);
		holder.release();
	});

	it('rejects a non-positive timeout', () => {
		expect(() => new SessionLease(0)).toThrow(RangeError);
	});
});
