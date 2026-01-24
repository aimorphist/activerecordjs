import { describe, it, expect } from 'vitest';
import { StaticDecider } from './static';
import type { DeciderContext } from './types';
import type { Destination } from '$lib/server/types';

const makeContext = (escrowBalance: bigint): DeciderContext => ({
	pipeId: 'test-pipe',
	escrowWallet: 'test-wallet',
	escrowBalance,
	splBalances: new Map(),
	trigger: {
		type: 'manual',
		timestamp: Date.now()
	}
});

const makeDestination = (address: string, shareBps: number, minAmount?: string): Destination => ({
	address,
	destinationType: 'wallet',
	shareBps,
	minAmount
});

describe('StaticDecider', () => {
	it('has type static', () => {
		const decider = new StaticDecider([]);
		expect(decider.type).toBe('static');
	});

	describe('decide()', () => {
		it('splits 50/50 correctly', async () => {
			const destinations = [
				makeDestination('wallet-a', 5000),
				makeDestination('wallet-b', 5000)
			];
			const decider = new StaticDecider(destinations);
			const ctx = makeContext(1_000_000_000n); // 1 SOL

			const result = await decider.decide(ctx);

			expect(result.distributions).toHaveLength(2);
			expect(result.distributions[0]).toEqual({
				destination: 'wallet-a',
				amount: '500000000',
				mint: undefined
			});
			expect(result.distributions[1]).toEqual({
				destination: 'wallet-b',
				amount: '500000000',
				mint: undefined
			});
		});

		it('gives remainder to last destination (no dust)', async () => {
			const destinations = [
				makeDestination('wallet-a', 3333),
				makeDestination('wallet-b', 3333),
				makeDestination('wallet-c', 3334)
			];
			const decider = new StaticDecider(destinations);
			const ctx = makeContext(1_000_000_000n); // 1 SOL

			const result = await decider.decide(ctx);

			// First two get 33.33% each
			expect(result.distributions[0].amount).toBe('333300000');
			expect(result.distributions[1].amount).toBe('333300000');
			// Last gets the remainder (333400000)
			expect(result.distributions[2].amount).toBe('333400000');

			// Total should equal original balance
			const total = result.distributions.reduce((sum, d) => sum + BigInt(d.amount), 0n);
			expect(total).toBe(1_000_000_000n);
		});

		it('handles uneven splits without dust', async () => {
			const destinations = [
				makeDestination('wallet-a', 1000), // 10%
				makeDestination('wallet-b', 2500), // 25%
				makeDestination('wallet-c', 6500) // 65%
			];
			const decider = new StaticDecider(destinations);
			const ctx = makeContext(1_000_000_003n); // odd number

			const result = await decider.decide(ctx);

			const total = result.distributions.reduce((sum, d) => sum + BigInt(d.amount), 0n);
			expect(total).toBe(1_000_000_003n);
		});

		it('skips destinations below minAmount threshold', async () => {
			const destinations = [
				makeDestination('wallet-a', 5000, '600000000'), // min 0.6 SOL
				makeDestination('wallet-b', 5000)
			];
			const decider = new StaticDecider(destinations);
			const ctx = makeContext(1_000_000_000n); // 1 SOL = 0.5 each

			const result = await decider.decide(ctx);

			// wallet-a is skipped bc 0.5 SOL < 0.6 SOL min
			expect(result.distributions).toHaveLength(1);
			expect(result.distributions[0].destination).toBe('wallet-b');
			expect(result.distributions[0].amount).toBe('500000000');
		});

		it('handles single destination (100%)', async () => {
			const destinations = [makeDestination('wallet-only', 10000)];
			const decider = new StaticDecider(destinations);
			const ctx = makeContext(1_000_000_000n);

			const result = await decider.decide(ctx);

			expect(result.distributions).toHaveLength(1);
			expect(result.distributions[0].amount).toBe('1000000000');
		});

		it('handles zero balance', async () => {
			const destinations = [
				makeDestination('wallet-a', 5000),
				makeDestination('wallet-b', 5000)
			];
			const decider = new StaticDecider(destinations);
			const ctx = makeContext(0n);

			const result = await decider.decide(ctx);

			expect(result.distributions).toHaveLength(2);
			expect(result.distributions[0].amount).toBe('0');
			expect(result.distributions[1].amount).toBe('0');
		});
	});
});
