import { describe, it, expect, vi } from 'vitest';
import { withRetry, DEFAULT_RETRY_POLICY } from './retry';

describe('withRetry', () => {
	it('returns result on success', async () => {
		const fn = vi.fn().mockResolvedValue('success');

		const result = await withRetry(fn);

		expect(result).toBe('success');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries on failure', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error('fail'))
			.mockRejectedValueOnce(new Error('fail'))
			.mockResolvedValue('success');

		const result = await withRetry(fn, { ...DEFAULT_RETRY_POLICY, initialDelayMs: 1 });

		expect(result).toBe('success');
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('throws after max retries', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('always fail'));

		await expect(
			withRetry(fn, { ...DEFAULT_RETRY_POLICY, maxRetries: 2, initialDelayMs: 1 })
		).rejects.toThrow('always fail');

		expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
	});

	it('respects isRetryable predicate', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('not retryable'));

		await expect(withRetry(fn, DEFAULT_RETRY_POLICY, () => false)).rejects.toThrow('not retryable');

		expect(fn).toHaveBeenCalledTimes(1);
	});
});
