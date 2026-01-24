import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/lib/activerecordjs/**/*.integration.{test,spec}.ts'],
		testTimeout: 30000,
		hookTimeout: 30000,
		// Run test files sequentially due to shared global DB connection.
		// Within each file, tests use transaction-based isolation (fast rollback).
		// True parallel execution would require per-file isolated connections.
		fileParallelism: false
	}
});
