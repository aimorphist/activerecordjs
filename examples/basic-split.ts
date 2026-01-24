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

// Devnet test wallets
const ESCROW = 'CfvMHKJD8xDGM41jun7yDPTweUivJeapVzNpgrcMksw6';
const CONTROLLER = ESCROW; // Use escrow as controller for simplicity
const DEST_1 = 'BVcBoujUZKqbR4PPCZLg5dD6gW7t43zodqwsx2Q2HAUb'; // 50%
const DEST_2 = '2AYqChc3owmwcaySkxmkSzqcXFc35e4U4X3QpPSyrMZQ'; // 30%
const DEST_3 = 'EBba14yitFvjoVuTVKxUrPwUjCwVVu7yzSCp7C78edVd'; // 20%

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

	// Trigger the pipe
	console.log('Triggering pipe...');
	const executionId = await bagpipe.trigger(pipe.id);
	console.log(`✓ Execution completed: ${executionId}\n`);

	// Check execution details
	const execution = await bagpipe.executions.find(executionId);
	console.log('Distributions:', JSON.stringify(execution.distributions, null, 2));
	console.log('TX Signatures:', execution.txSignatures);
}

main().catch(console.error);
