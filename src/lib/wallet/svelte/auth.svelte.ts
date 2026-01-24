// Main auth module - wires machine with adapters
// Uses Svelte 5 runes for reactive state

import { createSessionManager, type SessionManagerConfig } from '../adapters/session-manager';
import { createSystemBridge } from '../adapters/system-bridge';
import { createWalletBridge, type WalletBridge } from '../adapters/wallet-bridge';
import { createAuthMachine } from './machine.svelte';

export interface AuthConfig {
	session?: SessionManagerConfig;
	domain?: string;  // e.g., 'start.fun'
	uri?: string;     // e.g., 'https://start.fun'
	autoInit?: boolean; // Initialize system bridge and hydrate session automatically
}

/**
 * Create a wallet authentication instance
 * This is a factory function - you can create multiple instances with different configurations
 */
export function createAuth(config: AuthConfig = {}) {
	// Create session manager
	const sessionManager = createSessionManager(config.session);

	// Late-binding wallet bridge proxy (resolves circular dependency)
	let walletBridgeImpl: WalletBridge | undefined;

	const walletBridgeProxy = {
		signMessage: async (msg: string | Uint8Array) => {
			if (!walletBridgeImpl) throw new Error('WalletBridge not initialized');
			return walletBridgeImpl.signMessage(msg);
		},
		explicitDisconnect: async () => {
			if (!walletBridgeImpl) throw new Error('WalletBridge not initialized');
			return walletBridgeImpl.explicitDisconnect();
		},
		getCurrentGen: () => {
			return walletBridgeImpl?.getCurrentGen() ?? 0;
		}
	};

	// Create machine with proxy
	const machine = createAuthMachine({
		session: sessionManager,
		wallet: walletBridgeProxy,
		logger: console,
		getCurrentGen: () => walletBridgeProxy.getCurrentGen(),
		domain: config.domain,
		uri: config.uri
	});

	// Create actual wallet bridge with machine dispatch
	walletBridgeImpl = createWalletBridge(machine.dispatch);

	// Create system bridge with machine dispatch
	const systemBridge = createSystemBridge(machine.dispatch);

	// Auto-initialize if enabled (default: true)
	const autoInit = config.autoInit !== false;
	if (autoInit && typeof window !== 'undefined') {
		systemBridge.init();

		// Hydrate session on load (triggers HYDRATE_SESSION command)
		setTimeout(() => {
			machine.dispatch({ type: 'system.focus', focused: true });

			// Try to auto-reconnect wallet after hydration
			setTimeout(async () => {
				const { tryAutoReconnect } = await import('./helpers');
				tryAutoReconnect(walletBridgeImpl!).catch((err) => console.warn('[Auth] Auto-reconnect failed:', err));
			}, 100);
		}, 0);

		// Cleanup on window unload
		window.addEventListener('beforeunload', () => {
			systemBridge.dispose();
			walletBridgeImpl?.dispose();
			machine.dispose();
		});
	}

	return {
		// Machine API
		machine,
		state: machine.state,
		isReady: machine.isReady,
		walletPubkey: machine.walletPubkey,
		userId: machine.userId,
		isAuthenticating: machine.isAuthenticating,
		walletConnected: machine.walletConnected,
		status: machine.status,
		isHydrating: machine.isHydrating,
		sessionStatus: machine.sessionStatus,
		getState: machine.getState,
		dispatch: machine.dispatch,

		// Adapters
		walletBridge: walletBridgeImpl!,
		sessionManager,
		systemBridge,

		// Cleanup
		dispose: () => {
			systemBridge.dispose();
			walletBridgeImpl?.dispose();
			machine.dispose();
		}
	};
}

export type Auth = ReturnType<typeof createAuth>;
