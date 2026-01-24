// Wallet adapter bridge - factory function (no classes, no EventBus coupling)

import type { Adapter } from '@solana/wallet-adapter-base';
import type { AuthEvent } from '../core/events';

export function createWalletBridge(dispatch: (event: AuthEvent) => void) {
	let gen = 0;
	let sawAccountChange = false;
	let adapter: Adapter | undefined;
	let adapterId = '';
	let cleanupFns: Array<() => void> = [];

	function dispose() {
		cleanupFns.forEach((fn) => fn());
		cleanupFns = [];
		adapter = undefined;
		adapterId = '';
	}

	async function connect(id: string, walletAdapter: Adapter): Promise<void> {
		dispose();
		gen++;
		adapter = walletAdapter;
		adapterId = id;

		const handleConnect = () => {
			const pubkey = adapter?.publicKey?.toBase58();
			if (!pubkey) return;
			dispatch({ type: 'wallet.connected', adapterId, pubkey, gen });
			sawAccountChange = false;
		};

		const handleDisconnect = () => {
			const reason = sawAccountChange ? 'accountChange' : 'unknown';
			dispatch({ type: 'wallet.disconnected', adapterId, reason, gen });
			sawAccountChange = false;
		};

		const handleAccountChanged = (pk?: any) => {
			sawAccountChange = true;
			const newPubkey = pk?.toBase58?.();
			if (newPubkey) {
				gen++;
				dispatch({ type: 'wallet.account_changed', adapterId, pubkey: newPubkey, gen });
			} else {
				dispatch({ type: 'wallet.disconnected', adapterId, reason: 'accountChange', gen });
			}
		};

		const handleError = (err: any) => {
			const message = err?.message || 'Unknown wallet error';
			const code = err?.code || err?.name || 'WALLET_ERROR';
			dispatch({ type: 'wallet.error', adapterId, message, code, gen });
		};

		// Attach listeners (using 'on' method - some adapters support accountChanged)
		adapter.on?.('connect', handleConnect);
		adapter.on?.('disconnect', handleDisconnect);
		adapter.on?.('error', handleError);

		// Try to listen for account changes (not all adapters support this)
		try {
			(adapter as any).on?.('accountChanged', handleAccountChanged);
			cleanupFns.push(() => (adapter as any).off?.('accountChanged', handleAccountChanged));
		} catch (e) {
			// Adapter doesn't support accountChanged - that's ok
		}

		// Store cleanup functions
		cleanupFns.push(
			() => adapter?.off?.('connect', handleConnect),
			() => adapter?.off?.('disconnect', handleDisconnect),
			() => adapter?.off?.('error', handleError)
		);

		// Connect
		try {
			// Check if already connected before calling connect()
			const wasConnected = adapter.connected && adapter.publicKey;

			if (!wasConnected) {
				await adapter.connect();
			}

			// After connect(), check if adapter is now connected
			// This handles both:
			// 1. Adapters that were already connected (wasConnected = true)
			// 2. Adapters that don't emit 'connect' events (like Backpack)
			if (adapter.connected && adapter.publicKey) {
				handleConnect();
			}
		} catch (err: any) {
			handleError(err);
			throw err;
		}
	}

	async function explicitDisconnect(): Promise<void> {
		if (adapter) {
			try {
				await adapter.disconnect();
				dispatch({ type: 'wallet.disconnected', adapterId, reason: 'appInitiated', gen });
			} catch (err) {
				console.error('[wallet-bridge] Disconnect failed:', err);
			}
		}
		dispose();
	}

	async function signMessage(message: string | Uint8Array): Promise<Uint8Array> {
		if (!adapter) {
			throw new Error('Wallet not connected');
		}

		const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;

		try {
			// Type assertion - we know adapters support signMessage even if TS doesn't
			const sig = await (adapter as any).signMessage(messageBytes);
			return sig;
		} catch (err) {
			console.error('[wallet-bridge] Sign message failed:', err);
			throw err;
		}
	}

	return {
		connect,
		explicitDisconnect,
		signMessage,
		getAdapter: () => adapter,
		getCurrentGen: () => gen,
		dispose
	};
}

export type WalletBridge = ReturnType<typeof createWalletBridge>;
