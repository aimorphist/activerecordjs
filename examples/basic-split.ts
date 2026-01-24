/**
 * Basic Split Example
 *
 * Creates a pipe that splits incoming SOL 50/30/20 to three wallets.
 *
 * Prerequisites:
 * - Set ESCROW_KEY_<pipeId> env var with funded devnet wallet
 * - Set SOLANA_RPC_URL to devnet (e.g. https://api.devnet.solana.com)
 * - Run database migrations
 *
 * Usage:
 *   bun run examples/basic-split.ts
 *
 * Or with npm script:
 *   bun run example:basic-split
 */

import { createBagpipe } from '../src/lib/bagpipe';

// Replace these with actual devnet wallet addresses
const CONTROLLER = 'YOUR_CONTROLLER_WALLET_PUBKEY';
const ESCROW = 'YOUR_ESCROW_WALLET_PUBKEY';
const DEST_1 = 'DESTINATION_1_PUBKEY'; // 50%
const DEST_2 = 'DESTINATION_2_PUBKEY'; // 30%
const DEST_3 = 'DESTINATION_3_PUBKEY'; // 20%

async function main() {
	console.log('🎵 Bagpipe Basic Split Example\n');

	const bagpipe = createBagpipe();

	// Create the pipe
	console.log('Creating pipe...');
	const pipe = await bagpipe.pipes.create({
		name: 'basic-split-example',
		escrowWallet: ESCROW,
		controllerType: 'wallet',
		controllerId: CONTROLLER,
		deciderType: 'static',
		destinations: [
			{ address: DEST_1, destinationType: 'wallet', shareBps: 5000 },
			{ address: DEST_2, destinationType: 'wallet', shareBps: 3000 },
			{ address: DEST_3, destinationType: 'wallet', shareBps: 2000 }
		],
		triggerMode: { type: 'manual' }
	});
	console.log(`✓ Pipe created: ${pipe.id}`);
	console.log(`  Escrow: ${pipe.escrowWallet}`);
	console.log(`  Destinations: 50% / 30% / 20%\n`);

	// Note: You need to set ESCROW_KEY_<pipeId> in your environment
	// with the base58-encoded secret key for the escrow wallet
	console.log(`ℹ️  To trigger, set env var: ESCROW_KEY_${pipe.id}`);
	console.log('   with the base58 secret key for the escrow wallet.\n');

	// Uncomment to trigger after funding the escrow:
	// console.log('Triggering pipe...');
	// const executionId = await bagpipe.trigger(pipe.id);
	// console.log(`✓ Execution completed: ${executionId}`);

	// Check execution details
	// const execution = await bagpipe.executions.find(executionId);
	// console.log('Distributions:', execution.distributions);
	// console.log('TX Signatures:', execution.txSignatures);
}

main().catch(console.error);
