import { z } from 'zod';

export const configSchema = z.object({
	solana: z.object({
		rpcUrl: z.string().url(),
		commitment: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed')
	}),

	bags: z.object({
		apiKey: z.string().min(1),
		apiUrl: z.string().url().default('https://public-api-v2.bags.fm')
	}),

	scheduler: z.object({
		tickMs: z.coerce.number().min(1000).default(10_000),
		enabled: z.coerce.boolean().default(true)
	}),

	decider: z.object({
		timeoutMs: z.coerce.number().min(1000).default(30_000)
	})
});

export type Config = z.infer<typeof configSchema>;
