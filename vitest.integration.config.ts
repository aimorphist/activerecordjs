import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.integration.{test,spec}.ts'],
		testTimeout: 30000,
		hookTimeout: 30000,
		globalSetup: ['src/globalSetup.integration.ts']
	}
});
