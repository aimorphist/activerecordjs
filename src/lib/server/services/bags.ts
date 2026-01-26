import { BagsSDK, type BagsClaimablePosition } from '@bagsfm/bags-sdk';
import { Connection, Keypair, PublicKey, type Transaction } from '@solana/web3.js';
import type { Config } from '$lib/server/config';
import type { ClaimResult, ClaimablePosition, PositionType } from '$lib/server/types';
import { ClaimModel } from '$lib/server/models/claim';
import { BagsApiError, ClaimFailedError, NoClaimablePositionsError } from '$lib/server/errors';
import { withRetry } from '$lib/server/utils/retry';

export class BagsService {
	private sdk: BagsSDK;
	private connection: Connection;

	constructor(config: Config) {
		this.connection = new Connection(config.solana.rpcUrl, {
			commitment: config.solana.commitment as 'processed' | 'confirmed' | 'finalized'
		});
		this.sdk = new BagsSDK(
			config.bags.apiKey,
			this.connection,
			config.solana.commitment as 'processed' | 'confirmed' | 'finalized'
		);
	}

	/**
	 * Get all claimable positions for a wallet
	 */
	async getClaimablePositions(wallet: PublicKey): Promise<ClaimablePosition[]> {
		try {
			const positions = await withRetry(
				() => this.sdk.fee.getAllClaimablePositions(wallet),
				undefined,
				() => true
			);

			return positions.map((p) => ({
				baseMint: p.baseMint,
				virtualPoolClaimableAmount: this.getVirtualPoolAmount(p),
				dammPoolClaimableAmount: this.getDammPoolAmount(p),
				totalClaimableLamportsUserShare: p.totalClaimableLamportsUserShare,
				isMigrated: this.getIsMigrated(p),
				positionType: this.classifyPosition(p)
			}));
		} catch (e) {
			throw new BagsApiError(`Failed to get claimable positions: ${e}`);
		}
	}

	/**
	 * Claim all positions to the escrow wallet and record in DB
	 */
	async claimAll(escrowKeypair: Keypair, pipeId: string): Promise<ClaimResult> {
		const positions = await this.getClaimablePositions(escrowKeypair.publicKey);

		if (positions.length === 0) {
			throw new NoClaimablePositionsError(escrowKeypair.publicKey.toBase58());
		}

		// Get raw positions for SDK calls
		const rawPositions = await this.sdk.fee.getAllClaimablePositions(escrowKeypair.publicKey);
		return this.claimPositions(escrowKeypair, pipeId, positions, rawPositions);
	}

	/**
	 * Claim positions for a specific token only
	 */
	async claimForToken(
		escrowKeypair: Keypair,
		pipeId: string,
		tokenMint: string
	): Promise<ClaimResult> {
		const allPositions = await this.getClaimablePositions(escrowKeypair.publicKey);
		const positions = allPositions.filter((p) => p.baseMint === tokenMint);

		if (positions.length === 0) {
			throw new NoClaimablePositionsError(
				`${escrowKeypair.publicKey.toBase58()} for token ${tokenMint}`
			);
		}

		// Get raw positions for SDK calls
		const rawPositions = await this.sdk.fee.getAllClaimablePositions(escrowKeypair.publicKey);
		const filteredRawPositions = rawPositions.filter((p) => p.baseMint === tokenMint);

		return this.claimPositions(escrowKeypair, pipeId, positions, filteredRawPositions);
	}

	/**
	 * Internal: claim a set of positions
	 */
	private async claimPositions(
		escrowKeypair: Keypair,
		pipeId: string,
		positions: ClaimablePosition[],
		rawPositions: BagsClaimablePosition[]
	): Promise<ClaimResult> {
		const result: ClaimResult = {
			claimed: 0,
			totalLamports: 0n,
			transactions: [],
			claims: []
		};

		for (let i = 0; i < rawPositions.length; i++) {
			const rawPosition = rawPositions[i];
			const position = positions[i];

			try {
				// Get claim transactions from SDK
				const claimTxs = await this.sdk.fee.getClaimTransaction(
					escrowKeypair.publicKey,
					rawPosition
				);

				for (const tx of claimTxs) {
					// Sign and send transaction
					const signature = await this.signAndSendTransaction(tx, escrowKeypair);

					const amountLamports = BigInt(position.totalClaimableLamportsUserShare);

					// Record claim in database
					await ClaimModel.create({
						pipeId,
						tokenMint: position.baseMint,
						positionType: position.positionType,
						amountLamports,
						txSignature: signature
					});

					result.transactions.push(signature);
					result.claims.push({
						tokenMint: position.baseMint,
						amountLamports,
						txSignature: signature,
						positionType: position.positionType
					});
					result.totalLamports += amountLamports;
				}

				result.claimed++;
			} catch (e) {
				throw new ClaimFailedError(
					position.baseMint,
					e instanceof Error ? e.message : String(e)
				);
			}
		}

		return result;
	}

	/**
	 * Get virtual pool claimable amount from SDK position
	 */
	private getVirtualPoolAmount(position: BagsClaimablePosition): number {
		if ('virtualPoolClaimableAmount' in position) {
			return position.virtualPoolClaimableAmount ?? 0;
		}
		if ('virtualPoolClaimableLamportsUserShare' in position) {
			return position.virtualPoolClaimableLamportsUserShare ?? 0;
		}
		return 0;
	}

	/**
	 * Get DAMM pool claimable amount from SDK position
	 */
	private getDammPoolAmount(position: BagsClaimablePosition): number {
		if ('dammPoolClaimableAmount' in position && position.dammPoolClaimableAmount !== undefined) {
			return position.dammPoolClaimableAmount;
		}
		if ('dammPoolClaimableLamportsUserShare' in position) {
			return position.dammPoolClaimableLamportsUserShare ?? 0;
		}
		return 0;
	}

	/**
	 * Get isMigrated status from SDK position
	 */
	private getIsMigrated(position: BagsClaimablePosition): boolean {
		if ('isMigrated' in position) {
			return position.isMigrated ?? false;
		}
		return false;
	}

	/**
	 * Classify position type based on SDK response
	 */
	private classifyPosition(position: BagsClaimablePosition): PositionType {
		if ('isCustomFeeVault' in position && position.isCustomFeeVault) {
			return 'custom_vault';
		}
		if (this.getIsMigrated(position) && this.getDammPoolAmount(position) > 0) {
			return 'damm';
		}
		return 'virtual';
	}

	/**
	 * Sign and send a transaction
	 */
	private async signAndSendTransaction(tx: Transaction, signer: Keypair): Promise<string> {
		const { blockhash } = await this.connection.getLatestBlockhash();
		tx.recentBlockhash = blockhash;
		tx.feePayer = signer.publicKey;
		tx.sign(signer);

		const signature = await withRetry(
			() =>
				this.connection.sendRawTransaction(tx.serialize(), {
					skipPreflight: false,
					preflightCommitment: 'processed'
				}),
			undefined,
			() => true
		);

		await this.connection.confirmTransaction(signature, 'processed');
		return signature;
	}
}
