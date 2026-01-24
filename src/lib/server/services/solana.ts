import {
	Connection,
	PublicKey,
	Keypair,
	Transaction,
	SystemProgram,
	LAMPORTS_PER_SOL,
	type Commitment
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SolanaRpcError, TransactionFailedError } from '$lib/server/errors';
import { withRetry } from '$lib/server/utils/retry';
import type { Config } from '$lib/server/config';

export class SolanaService {
	private connection: Connection;
	private commitment: Commitment;

	constructor(config: Config['solana']) {
		this.commitment = config.commitment as Commitment;
		this.connection = new Connection(config.rpcUrl, {
			commitment: this.commitment,
			confirmTransactionInitialTimeout: 60_000
		});
	}

	getConnection(): Connection {
		return this.connection;
	}

	async getBalance(pubkey: PublicKey): Promise<bigint> {
		try {
			const lamports = await withRetry(
				() => this.connection.getBalance(pubkey),
				undefined,
				() => true
			);
			return BigInt(lamports);
		} catch (e) {
			throw new SolanaRpcError(`Failed to get balance: ${e}`);
		}
	}

	async getSplBalances(owner: PublicKey): Promise<Map<string, bigint>> {
		try {
			const accounts = await withRetry(
				() =>
					this.connection.getParsedTokenAccountsByOwner(owner, {
						programId: TOKEN_PROGRAM_ID
					}),
				undefined,
				() => true
			);

			const balances = new Map<string, bigint>();
			for (const { account } of accounts.value) {
				const info = account.data.parsed.info;
				balances.set(info.mint, BigInt(info.tokenAmount.amount));
			}
			return balances;
		} catch (e) {
			throw new SolanaRpcError(`Failed to get SPL balances: ${e}`);
		}
	}

	async getRecentBlockhash(): Promise<string> {
		const { blockhash } = await this.connection.getLatestBlockhash(this.commitment);
		return blockhash;
	}

	async sendTransaction(tx: Transaction, signers: Keypair[]): Promise<string> {
		try {
			const signature = await withRetry(
				async () => {
					const blockhash = await this.getRecentBlockhash();
					tx.recentBlockhash = blockhash;
					tx.feePayer = signers[0].publicKey;

					tx.sign(...signers);

					return this.connection.sendRawTransaction(tx.serialize(), {
						skipPreflight: false,
						preflightCommitment: this.commitment
					});
				},
				undefined,
				() => true
			);

			// Wait for confirmation
			const confirmation = await this.connection.confirmTransaction(signature, this.commitment);

			if (confirmation.value.err) {
				throw new TransactionFailedError(signature, JSON.stringify(confirmation.value.err));
			}

			return signature;
		} catch (e) {
			if (e instanceof TransactionFailedError) throw e;
			throw new SolanaRpcError(`Failed to send transaction: ${e}`);
		}
	}

	async transferSol(from: Keypair, to: PublicKey, lamports: bigint): Promise<string> {
		const tx = new Transaction().add(
			SystemProgram.transfer({
				fromPubkey: from.publicKey,
				toPubkey: to,
				lamports: Number(lamports)
			})
		);

		return this.sendTransaction(tx, [from]);
	}

	// Convert SOL to lamports
	static solToLamports(sol: number): bigint {
		return BigInt(Math.floor(sol * LAMPORTS_PER_SOL));
	}

	// Convert lamports to SOL
	static lamportsToSol(lamports: bigint): number {
		return Number(lamports) / LAMPORTS_PER_SOL;
	}
}
