import { configSchema, type Config } from './schema';

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
	if (cachedConfig) return cachedConfig;

	const raw = {
		solana: {
			rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
			commitment: process.env.SOLANA_COMMITMENT
		},
		bags: {
			apiKey: process.env.BAGS_API_KEY ?? '',
			apiUrl: process.env.BAGS_API_URL
		},
		scheduler: {
			tickMs: process.env.SCHEDULER_TICK_MS,
			enabled: process.env.SCHEDULER_ENABLED
		},
		decider: {
			timeoutMs: process.env.DECIDER_TIMEOUT_MS
		}
	};

	cachedConfig = configSchema.parse(raw);
	return cachedConfig;
}

export function resetConfig(): void {
	cachedConfig = null;
}

export type { Config };
