import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/lib/activerecordjs/**/*.integration.{test,spec}.ts'],
		testTimeout: 30000,
		hookTimeout: 30000,
		// Run test files sequentially to avoid database conflicts
		fileParallelism: false
	}
});
