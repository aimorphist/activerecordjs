import { PublicKey, type Keypair } from '@solana/web3.js';
import type { Pipe } from '$lib/server/db/schema';
import type { Destination } from '$lib/server/types';
import { PipeModel } from '$lib/server/models/pipe';
import { ExecutionModel } from '$lib/server/models/execution';
import { SolanaService } from './solana';
import { EnvWalletService, type WalletService } from './wallet';
import { createDecider, type DeciderContext } from '$lib/server/deciders';
import {
	PipeDisabledError,
	InsufficientBalanceError,
	ExecutionError
} from '$lib/server/errors';
import type { Config } from '$lib/server/config';

export class PipeService {
	private solana: SolanaService;
	private wallet: WalletService;

	constructor(config: Config) {
		this.solana = new SolanaService(config.solana);
		this.wallet = new EnvWalletService();
	}

	async trigger(
		pipeId: string,
		triggerType: 'manual' | 'threshold' | 'cron' = 'manual'
	): Promise<string> {
		// 1. Load pipe
		const pipe = await PipeModel.find(pipeId);
		if (!pipe.enabled) {
			throw new PipeDisabledError(pipeId);
		}

		// 2. Get escrow keypair
		const escrowKeypair = await this.wallet.getEscrowKeypair(pipeId);
		const escrowPubkey = escrowKeypair.publicKey;

		// 3. Get current balance
		const balance = await this.solana.getBalance(escrowPubkey);
		const splBalances = await this.solana.getSplBalances(escrowPubkey);

		// 4. Create execution record
		const execution = await ExecutionModel.create({
			pipeId,
			triggerType,
			balanceBefore: balance,
			splBalancesBefore: Object.fromEntries(
				[...splBalances.entries()].map(([k, v]) => [k, v.toString()])
			)
		});

		try {
			// 5. Mark as deciding
			await ExecutionModel.markDeciding(execution.id);
			const decideStart = Date.now();

			// 6. Build context & run decider
			const ctx: DeciderContext = {
				pipeId: pipe.id,
				escrowWallet: pipe.escrowWallet,
				escrowBalance: balance,
				splBalances,
				trigger: {
					type: triggerType,
					timestamp: Date.now()
				}
			};

			const decider = createDecider(
				pipe.deciderType as 'static' | 'lambda',
				pipe.deciderConfig as Record<string, unknown>,
				pipe.destinations as Destination[]
			);
			const result = await decider.decide(ctx);
			const deciderDurationMs = Date.now() - decideStart;

			// 7. Mark as executing
			await ExecutionModel.markExecuting(execution.id, result, deciderDurationMs);

			// 8. Validate we have enough balance
			const totalToSend = result.distributions.reduce(
				(sum, d) => sum + BigInt(d.amount),
				0n
			);
			if (totalToSend > balance) {
				throw new InsufficientBalanceError(totalToSend, balance);
			}

			// 9. Execute transfers
			const txSignatures: string[] = [];
			for (const dist of result.distributions) {
				if (BigInt(dist.amount) === 0n) continue; // skip zero transfers
				const sig = await this.solana.transferSol(
					escrowKeypair,
					new PublicKey(dist.destination),
					BigInt(dist.amount)
				);
				txSignatures.push(sig);
			}

			// 10. Mark completed
			await ExecutionModel.markCompleted(
				execution.id,
				result.distributions,
				txSignatures
			);

			// 11. Update pipe lastTriggeredAt
			await PipeModel.updateLastTriggered(pipeId);

			return execution.id;
		} catch (error) {
			// Mark as failed
			const message = error instanceof Error ? error.message : String(error);
			await ExecutionModel.markFailed(execution.id, message);
			throw new ExecutionError(execution.id, message);
		}
	}
}
