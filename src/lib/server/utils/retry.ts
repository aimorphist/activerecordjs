export interface RetryPolicy {
	maxRetries: number;
	initialDelayMs: number;
	maxDelayMs: number;
	backoffMultiplier: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxRetries: 5,
	initialDelayMs: 1000,
	maxDelayMs: 60_000,
	backoffMultiplier: 2
};

function calculateDelay(policy: RetryPolicy, attempt: number): number {
	const baseDelay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt);
	const cappedDelay = Math.min(baseDelay, policy.maxDelayMs);
	const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);
	return Math.floor(cappedDelay + jitter);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	policy: RetryPolicy = DEFAULT_RETRY_POLICY,
	isRetryable: (err: Error) => boolean = () => true
): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (e) {
			lastError = e as Error;

			if (!isRetryable(lastError) || attempt === policy.maxRetries) {
				throw lastError;
			}

			const delay = calculateDelay(policy, attempt);
			await sleep(delay);
		}
	}

	throw lastError;
}
