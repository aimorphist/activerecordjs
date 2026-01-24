import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { WalletNotFoundError } from '$lib/server/errors';

export interface WalletService {
	getEscrowKeypair(pipeId: string): Promise<Keypair>;
	hasAccess(pubkey: PublicKey): Promise<boolean>;
}

/**
 * Wallet service that reads escrow keys from environment variables.
 * Convention: ESCROW_KEY_<pipeId> = base58 private key
 */
export class EnvWalletService implements WalletService {
	private cache = new Map<string, Keypair>();

	async getEscrowKeypair(pipeId: string): Promise<Keypair> {
		if (this.cache.has(pipeId)) {
			return this.cache.get(pipeId)!;
		}

		const envKey = `ESCROW_KEY_${pipeId}`;
		const secretKey = process.env[envKey];

		if (!secretKey) {
			throw new WalletNotFoundError(pipeId);
		}

		try {
			const keypair = Keypair.fromSecretKey(bs58.decode(secretKey));
			this.cache.set(pipeId, keypair);
			return keypair;
		} catch {
			throw new WalletNotFoundError(pipeId);
		}
	}

	async hasAccess(pubkey: PublicKey): Promise<boolean> {
		for (const [key, value] of Object.entries(process.env)) {
			if (key.startsWith('ESCROW_KEY_') && value) {
				try {
					const kp = Keypair.fromSecretKey(bs58.decode(value));
					if (kp.publicKey.equals(pubkey)) return true;
				} catch {
					// Invalid key, skip
				}
			}
		}
		return false;
	}

	// Helper to generate a new keypair (for testing)
	static generateKeypair(): { publicKey: string; secretKey: string } {
		const kp = Keypair.generate();
		return {
			publicKey: kp.publicKey.toBase58(),
			secretKey: bs58.encode(kp.secretKey)
		};
	}
}
