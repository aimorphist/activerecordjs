import { defineConfig } from 'vitest/config';

// `test:pglite` sets PGLITE=1: it runs only the PGlite-backed files (WASM
// Postgres, no docker). `test:unit` leaves them out.
const pglite = process.env.PGLITE === '1';

export default defineConfig({
	test: {
		environment: 'node',
		include: pglite ? ['src/**/*.pglite.test.ts'] : ['src/**/*.{test,spec}.ts'],
		exclude: pglite
			? []
			: ['src/**/*.integration.{test,spec}.ts', 'src/**/*.pglite.test.ts'],
		testTimeout: pglite ? 30_000 : 5_000,
		hookTimeout: pglite ? 60_000 : 10_000
	}
});
