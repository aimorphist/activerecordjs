/**
 * Bags Redirect Example
 *
 * Demonstrates Bagpipe's value over native Bags.fm fee-sharing:
 * - Bags: Static 50/30/20 split configured at token launch (immutable)
 * - Bagpipe: Dynamic routing that can change anytime
 *
 * This example shows a charity-on-weekends pattern:
 * - Weekdays: 70% creator, 30% treasury
 * - Weekends: 70% charity, 30% creator
 *
 * This is IMPOSSIBLE with native Bags - you'd need to redeploy the token!
 *
 * Prerequisites:
 * - Set ESCROW_KEY_<pipeId> env var with funded wallet that has Bags positions
 * - Set BAGS_API_KEY with your Bags.fm API key
 * - Set SOLANA_RPC_URL (mainnet for real claims, devnet for testing)
 * - Run database migrations
 *
 * Usage:
 *   bun run examples/bags-redirect.ts
 */

import { createBagpipe } from '../src/lib/bagpipe';
import { SolanaService } from '../src/lib/server/services/solana';
import { NoClaimablePositionsError } from '../src/lib/server/errors';

// Why Bagpipe?
//
// With native Bags.fm, you configure fee splits AT TOKEN LAUNCH:
//   Creator: 70%, Charity: 30% -- FOREVER, immutable
//
// With Bagpipe, the Bags token sends 100% to your escrow wallet,
// then Bagpipe routes dynamically based on ANY logic you want.
// Change it anytime. No token redeployment needed.

const CREATOR = 'CreatorWallet1111111111111111111111111111';
const CHARITY = 'CharityWallet11111111111111111111111111111';
const TREASURY = 'TreasuryWallet111111111111111111111111111';

async function main() {
	console.log('Bags Redirect Example');
	console.log('Demonstrating dynamic routing (impossible with native Bags)\n');

	const bagpipe = createBagpipe();
	const isWeekend = [0, 6].includes(new Date().getDay());

	console.log(`Today is a ${isWeekend ? 'WEEKEND' : 'WEEKDAY'}`);
	console.log(
		isWeekend
			? '  -> Routing 70% to charity, 30% to creator'
			: '  -> Routing 70% to creator, 30% to treasury'
	);
	console.log('');

	// Dynamic destinations based on day of week
	// With Bags native: impossible - splits are immutable at launch
	// With Bagpipe: just change the pipe config anytime
	const destinations = isWeekend
		? [
				{ address: CHARITY, destinationType: 'wallet' as const, shareBps: 7000 },
				{ address: CREATOR, destinationType: 'wallet' as const, shareBps: 3000 }
			]
		: [
				{ address: CREATOR, destinationType: 'wallet' as const, shareBps: 7000 },
				{ address: TREASURY, destinationType: 'wallet' as const, shareBps: 3000 }
			];

	// Create pipe with current routing
	console.log('Creating royalty routing pipe...');
	const pipe = await bagpipe.pipes.create({
		name: 'weekend-charity-redirect',
		escrowWallet: 'YourEscrowWallet111111111111111111111111', // Replace with actual
		controllerType: 'wallet',
		controllerId: 'YourControllerWallet1111111111111111111', // Replace with actual
		deciderType: 'static',
		destinations,
		triggerMode: { type: 'manual' }
	});
	console.log(`Pipe created: ${pipe.id}`);
	console.log(`  Escrow: ${pipe.escrowWallet}\n`);

	// Claim from Bags and route through our pipe
	console.log('Claiming Bags royalties and routing...');
	try {
		const { claimResult, executionId } = await bagpipe.claimAndExecute(pipe.id);

		console.log(`\nClaimed ${claimResult.claimed} positions`);
		console.log(`  Total: ${SolanaService.lamportsToSol(claimResult.totalLamports)} SOL`);

		const execution = await bagpipe.executions.find(executionId);
		console.log('\nDistributions:');
		for (const dist of execution.distributions as { destination: string; amount: string }[]) {
			const solAmount = SolanaService.lamportsToSol(BigInt(dist.amount));
			console.log(`  -> ${dist.destination}: ${solAmount} SOL`);
		}

		console.log('\nKey insight: Tomorrow this could route completely differently!');
		console.log('   Native Bags would require redeploying the token to change splits.');
	} catch (error) {
		if (error instanceof NoClaimablePositionsError) {
			console.log('No claimable positions found.');
			console.log('');
			console.log('To use this example:');
			console.log('1. Create a Bags.fm token with your escrow wallet as the fee claimer');
			console.log('2. Generate some trading volume to accrue fees');
			console.log('3. Run this script to claim and route dynamically');
			console.log('');
			console.log('The key point: Bags sends 100% to your escrow, then Bagpipe');
			console.log('handles all downstream routing with full programmability.');
		} else {
			throw error;
		}
	}
}

main().catch(console.error);
