/**
 * Environment variable shim that works in both SvelteKit and CLI contexts.
 *
 * Usage:
 *   import { env } from '$lib/server/env';
 *   const dbUrl = env.DATABASE_URL;
 *
 * Loads .env automatically for CLI scripts. SvelteKit's vite plugin
 * also loads .env, so this works in both contexts.
 */

import 'dotenv/config';

export const env = process.env as Record<string, string | undefined>;
