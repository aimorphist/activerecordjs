import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/lib/activerecordjs/**/*.integration.{test,spec}.ts'],
		testTimeout: 30000,
		hookTimeout: 30000,
		// Global setup creates tables once before all tests
		globalSetup: ['src/lib/activerecordjs/globalSetup.integration.ts']
		// Transaction-based test isolation with per-test connections
		// Each test gets its own connection, enabling parallel file execution
	}
});
