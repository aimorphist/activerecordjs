// Command types for side effects

import bs58 from 'bs58';
import type { AuthEvent } from './events';

export type Command =
	| { type: 'HYDRATE_SESSION' }
	| { type: 'START_SIWS'; wallet: { pubkey: string; adapterId: string; gen: number } }
	| { type: 'DISCONNECT_WALLET'; reason?: string; gen?: number }
	| { type: 'LOGOUT_SESSION'; reason?: string; hard?: boolean }
	| { type: 'SCHEDULE_RECONNECT'; delayMs: number }
	| { type: 'CLEAR_RECONNECT_TIMER' };

// Interfaces for adapters (will be factories in Phase 3)
export interface SessionManager {
	hydrate(): Promise<{
		established: boolean;
		userId?: string;
		walletPubkey?: string;
		expiresAt?: string;
	}>;
	getNonce(pubkey: string): Promise<{ nonce: string; issuedAt: string; expiresAt: string }>;
	establish(input: {
		pubkey: string;
		nonce: string;
		signature: string;
		adapterId?: string;
	}): Promise<{
		userId: string;
		walletPubkey: string;
		expiresAt?: string;
	}>;
	invalidate(reason?: string, hard?: boolean): Promise<void>;
}

export interface WalletBridge {
	signMessage(message: string | Uint8Array): Promise<Uint8Array>;
	explicitDisconnect(): Promise<void>;
	getCurrentGen(): number;
}

export interface CommandDeps {
	session: SessionManager;
	wallet: WalletBridge;
	logger?: Console;
	getCurrentGen: () => number;
	domain?: string;  // Injected domain (e.g., 'start.fun')
	uri?: string;     // Injected URI (e.g., 'https://start.fun')
}

function buildSIWSMessage(opts: {
	pubkey: string;
	nonce: string;
	domain: string;
	uri: string;
	issuedAt: string;
	expiresAt: string;
}): string {
	return `${opts.domain} wants you to sign in with your Solana account:
${opts.pubkey}

Sign in with Solana to the app.

URI: ${opts.uri}
Nonce: ${opts.nonce}
Issued At: ${opts.issuedAt}
Expiration Time: ${opts.expiresAt}`;
}

export async function handleCommand(cmd: Command, deps: CommandDeps): Promise<AuthEvent[]> {
	const { session, wallet, logger = console, getCurrentGen } = deps;
	const genOk = (cmdGen?: number) => cmdGen === undefined || cmdGen === getCurrentGen();

	try {
		switch (cmd.type) {
			case 'HYDRATE_SESSION': {
				const snap = await session.hydrate();
				return [
					{
						type: 'session.hydrated',
						session: {
							established: !!snap.established,
							userId: snap.userId,
							walletPubkey: snap.walletPubkey,
							expiresAt: snap.expiresAt
						}
					}
				];
			}

			case 'START_SIWS': {
				if (!genOk(cmd.wallet.gen)) {
					logger.debug?.('[commands] drop START_SIWS stale gen', {
						expected: getCurrentGen(),
						got: cmd.wallet.gen
					});
					return [];
				}

				try {
					const { nonce, issuedAt, expiresAt } = await session.getNonce(cmd.wallet.pubkey);

					// Use injected domain/uri or fallback to window.location (browser only)
					const domain = deps.domain || (typeof window !== 'undefined' ? window.location.host : 'localhost');
					const uri = deps.uri || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');

					const message = buildSIWSMessage({
						pubkey: cmd.wallet.pubkey,
						nonce,
						domain,
						uri,
						issuedAt,
						expiresAt
					});

					const signature = await wallet.signMessage(message);

					// Re-check gen after async wallet call
					if (!genOk(cmd.wallet.gen)) {
						logger.debug?.('[commands] drop START_SIWS post-sign stale gen');
						return [];
					}

					// Convert Uint8Array signature to base58 (matches backend expectations)
					const base58Signature = bs58.encode(signature);

					const res = await session.establish({
						pubkey: cmd.wallet.pubkey,
						nonce,
						signature: base58Signature,
						adapterId: cmd.wallet.adapterId
					});

					return [
						{
							type: 'session.established',
							userId: res.userId,
							walletPubkey: res.walletPubkey,
							expiresAt: res.expiresAt
						}
					];
				} catch (err: any) {
					logger.error?.('[commands] START_SIWS failed:', err);
					const status = err?.status as number | undefined;
					const code =
						err?.code ||
						(status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : undefined);
					const hard = status === 401 || status === 403;
					return [
						{
							type: 'session.invalidated',
							reason: code || err?.message || 'auth_failed',
							...(hard ? { hard: true } : {})
						}
					];
				}
			}

			case 'DISCONNECT_WALLET': {
				if (!genOk(cmd.gen)) {
					logger.debug?.('[commands] drop DISCONNECT_WALLET stale gen');
					return [];
				}
				try {
					await wallet.explicitDisconnect();
				} catch (err) {
					logger.error?.('[commands] DISCONNECT_WALLET failed:', err);
				}
				return [];
			}

			case 'LOGOUT_SESSION': {
				try {
					await session.invalidate(cmd.reason, cmd.hard);
					return [
						{
							type: 'session.invalidated',
							reason: cmd.reason,
							hard: cmd.hard
						}
					];
				} catch (err) {
					logger.error?.('[commands] LOGOUT_SESSION failed:', err);
					// Fail-closed: treat as invalidated anyway
					return [
						{
							type: 'session.invalidated',
							reason: 'logout_failed'
						}
					];
				}
			}

			// Timer commands handled by machine layer, not here
			case 'SCHEDULE_RECONNECT':
			case 'CLEAR_RECONNECT_TIMER':
				return [];
		}
	} catch (e) {
		logger.error?.('[commands] command failed', cmd, e);
		return [];
	}
}
