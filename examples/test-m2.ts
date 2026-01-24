/**
 * M2 Verification Test
 * Standalone script that doesn't rely on SvelteKit
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { Keypair, PublicKey, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import * as schema from '../src/lib/server/db/schema';
import { validateDestinations } from '../src/lib/server/utils/validation';
import { StaticDecider } from '../src/lib/server/deciders/static';
import type { DeciderContext } from '../src/lib/server/deciders/types';

// Config from env
const DATABASE_URL = process.env.DATABASE_URL!;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const ESCROW_SECRET = process.env.ESCROW_KEY_pipe_c79cd9a0d602!;

// Wallets
const ESCROW = 'CfvMHKJD8xDGM41jun7yDPTweUivJeapVzNpgrcMksw6';
const DEST_1 = 'BVcBoujUZKqbR4PPCZLg5dD6gW7t43zodqwsx2Q2HAUb'; // 50%
const DEST_2 = '2AYqChc3owmwcaySkxmkSzqcXFc35e4U4X3QpPSyrMZQ'; // 30%
const DEST_3 = 'EBba14yitFvjoVuTVKxUrPwUjCwVVu7yzSCp7C78edVd'; // 20%

const destinations = [
	{ address: DEST_1, destinationType: 'wallet' as const, shareBps: 5000 },
	{ address: DEST_2, destinationType: 'wallet' as const, shareBps: 3000 },
	{ address: DEST_3, destinationType: 'wallet' as const, shareBps: 2000 }
];

async function main() {
	console.log('🎵 Bagpipe M2 Verification Test\n');

	// 1. Check env
	if (!DATABASE_URL) throw new Error('DATABASE_URL not set');
	if (!ESCROW_SECRET) throw new Error('ESCROW_KEY_pipe_c79cd9a0d602 not set');

	// 2. Connect to DB
	console.log('Connecting to database...');
	const client = postgres(DATABASE_URL);
	const db = drizzle(client, { schema });
	console.log('✓ Database connected\n');

	// 3. Connect to Solana
	console.log('Connecting to Solana...');
	const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
	const escrowKeypair = Keypair.fromSecretKey(bs58.decode(ESCROW_SECRET));
	console.log('✓ Escrow pubkey:', escrowKeypair.publicKey.toBase58());

	// 4. Check balance
	const balance = await connection.getBalance(escrowKeypair.publicKey);
	console.log(`✓ Escrow balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

	if (balance < 0.1 * LAMPORTS_PER_SOL) {
		throw new Error('Escrow needs at least 0.1 SOL');
	}

	// 5. Validate destinations
	console.log('Validating destinations...');
	validateDestinations(destinations);
	console.log('✓ Destinations valid (sum to 10000 bps)\n');

	// 6. Run static decider
	console.log('Running static decider...');
	const decider = new StaticDecider(destinations);
	const ctx: DeciderContext = {
		pipeId: 'test',
		escrowWallet: ESCROW,
		escrowBalance: BigInt(balance),
		splBalances: new Map(),
		trigger: { type: 'manual', timestamp: Date.now() }
	};
	const result = await decider.decide(ctx);
	console.log('✓ Decider result:');
	for (const dist of result.distributions) {
		const pct = destinations.find((d) => d.address === dist.destination)?.shareBps! / 100;
		console.log(`  ${dist.destination.slice(0, 8)}... → ${Number(dist.amount) / LAMPORTS_PER_SOL} SOL (${pct}%)`);
	}
	console.log();

	// 7. Execute transfers
	console.log('Executing transfers on devnet...');
	const { Transaction, SystemProgram, sendAndConfirmTransaction } = await import('@solana/web3.js');

	const signatures: string[] = [];
	for (const dist of result.distributions) {
		const tx = new Transaction().add(
			SystemProgram.transfer({
				fromPubkey: escrowKeypair.publicKey,
				toPubkey: new PublicKey(dist.destination),
				lamports: BigInt(dist.amount)
			})
		);

		const sig = await sendAndConfirmTransaction(connection, tx, [escrowKeypair]);
		signatures.push(sig);
		console.log(`  ✓ Sent to ${dist.destination.slice(0, 8)}... tx: ${sig.slice(0, 16)}...`);
	}

	console.log('\n✅ M2 Verification Complete!');
	console.log('Transactions:', signatures);

	// Cleanup
	await client.end();
}

main().catch((err) => {
	console.error('❌ Error:', err.message);
	process.exit(1);
});
