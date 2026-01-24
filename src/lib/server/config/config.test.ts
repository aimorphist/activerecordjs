import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, resetConfig } from './index';

describe('Config', () => {
	beforeEach(() => {
		resetConfig();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('loads config from environment', () => {
		vi.stubEnv('SOLANA_RPC_URL', 'https://api.devnet.solana.com');
		vi.stubEnv('BAGS_API_KEY', 'test-key');

		const config = loadConfig();

		expect(config.solana.rpcUrl).toBe('https://api.devnet.solana.com');
		expect(config.bags.apiKey).toBe('test-key');
	});

	it('uses defaults for optional values', () => {
		vi.stubEnv('BAGS_API_KEY', 'test-key');

		const config = loadConfig();

		expect(config.solana.commitment).toBe('confirmed');
		expect(config.scheduler.tickMs).toBe(10_000);
	});

	it('caches config on subsequent calls', () => {
		vi.stubEnv('BAGS_API_KEY', 'test-key');

		const config1 = loadConfig();
		const config2 = loadConfig();

		expect(config1).toBe(config2);
	});
});
