import type { Destination, Distribution, DeciderResult } from '$lib/server/types';
import type { Decider, DeciderContext } from './types';

export class StaticDecider implements Decider {
	readonly type = 'static' as const;

	constructor(private destinations: Destination[]) {}

	async decide(ctx: DeciderContext): Promise<DeciderResult> {
		const distributions: Distribution[] = [];
		let remaining = ctx.escrowBalance;

		for (let i = 0; i < this.destinations.length; i++) {
			const dest = this.destinations[i];
			const isLast = i === this.destinations.length - 1;

			// Last destination gets remainder to avoid rounding dust
			const amount = isLast
				? remaining
				: (ctx.escrowBalance * BigInt(dest.shareBps)) / 10000n;

			// Skip if below min threshold
			if (dest.minAmount && amount < BigInt(dest.minAmount)) {
				continue;
			}

			distributions.push({
				destination: dest.address,
				amount: amount.toString(),
				mint: undefined
			});

			remaining -= amount;
		}

		return { distributions };
	}
}
