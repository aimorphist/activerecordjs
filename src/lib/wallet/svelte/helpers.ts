// Helper functions for components to interact with auth system
// Provides high-level API wrapping bridges and adapters

import { createAdapters } from '../adapters/wallet-adapters';
import { createDetectedWalletAdapter } from '../adapters/wallet-detect';
import { isInsideWalletBrowser } from '../adapters/mobile';
import type { WalletBridge } from '../adapters/wallet-bridge';
import type { AuthMachine } from './machine.svelte';
import { getWallets } from '@wallet-standard/app';

// Configuration for helpers
export interface HelpersConfig {
	rpcUrl?: string;
}

// Module-level state (initialized lazily)
let adapters: Record<string, any> = {};
let detectedWallets: Array<{ id: string; name: string; icon: string }> = [];
let initialized = false;

function ensureInitialized(config: HelpersConfig = {}) {
	if (!initialized) {
		adapters = createAdapters();
		detectWallets();
		initialized = true;
	}
}

function detectWallets() {
	try {
		const detected = getWallets();
		detectedWallets = detected.get().map((wallet) => {
			const normalizedId = wallet.name.toLowerCase().split(' ')[0];
			return {
				id: normalizedId,
				name: wallet.name,
				icon: wallet.icon
			};
		});
	} catch (error) {
		console.warn('Failed to detect Wallet Standard wallets:', error);
		detectedWallets = [];
	}
}

/**
 * Check if any wallet is already connected and reconnect
 * Useful after session hydration to restore wallet state
 */
export async function tryAutoReconnect(walletBridge: WalletBridge, config: HelpersConfig = {}): Promise<boolean> {
	ensureInitialized(config);

	// Skip auto-reconnect if user explicitly disconnected
	if (wasExplicitlyDisconnected()) {
		console.log('[Auth] Skipping auto-reconnect - user explicitly disconnected');
		return false;
	}

	// Check all adapters for existing connection
	for (const [id, adapter] of Object.entries(adapters)) {
		// Policy:
		// - Never auto-connect Solflare (requires explicit user choice)
		// - Auto-connect Phantom only when inside Phantom in-app browser
		// - Otherwise, only attempt silent reconnect for adapters that are Installed (no deep links)
		const inside = typeof window !== 'undefined' ? isInsideWalletBrowser() : { isInside: false };

		// Skip Solflare auto-connect completely
		if (id === 'solflare') {
			// no-op
		} else if (
			id === 'phantom' &&
			inside.isInside &&
			inside.walletId === 'phantom' &&
			(adapter.readyState === 'Installed' || adapter.readyState === 'Loadable')
		) {
			// Allow Phantom auto-connect in Phantom browser (Installed or Loadable is fine)
			try {
				await adapter.connect({ onlyIfTrusted: true } as any);
				if (adapter.connected && adapter.publicKey) {
					await walletBridge.connect(id, adapter);
					return true;
				}
			} catch {
				// Silent failure if not trusted previously
			}
		} else if (adapter.readyState === 'Installed') {
			// Desktop or other cases: Installed only, to avoid mobile deep links
			try {
				await adapter.connect({ onlyIfTrusted: true } as any);
				if (adapter.connected && adapter.publicKey) {
					await walletBridge.connect(id, adapter);
					return true;
				}
			} catch {
				// Silent failure if not trusted previously
			}
		}

		// Fallback: check if already connected
		if (adapter.connected && adapter.publicKey) {
			try {
				await walletBridge.connect(id, adapter);
				return true;
			} catch (err) {
				console.warn('[Auth] Auto-reconnect failed for', id, err);
			}
		}
	}

	return false;
}

/**
 * Connect to a wallet by ID
 * Creates adapter and initiates connection flow
 */
export async function connectWallet(walletId: string, walletBridge: WalletBridge, config: HelpersConfig = {}): Promise<void> {
	ensureInitialized(config);

	console.log('[Auth] connectWallet called with:', walletId);
	console.log('[Auth] Available adapters:', Object.keys(adapters));

	// Clear explicit disconnect flag - user is manually connecting
	clearExplicitDisconnect();

	let adapter = adapters[walletId];
	console.log(
		'[Auth] Found adapter:',
		adapter?.name || 'none',
		'readyState:',
		(adapter as any)?.readyState
	);

	// Try detected wallets if not found in explicit adapters
	if (!adapter) {
		console.log('[Auth] Trying detected wallets...');
		const detectedWallet = detectedWallets.find((w) => w.id === walletId);
		if (detectedWallet) {
			adapter = createDetectedWalletAdapter(walletId);
			console.log('[Auth] Created detected adapter:', adapter?.name);
		}
	}

	if (!adapter) {
		console.error('[Auth] No adapter found for:', walletId);
		throw new Error(`Wallet adapter not found: ${walletId}`);
	}

	// Connect via wallet bridge
	console.log('[Auth] Calling walletBridge.connect...');
	await walletBridge.connect(walletId, adapter);
	console.log('[Auth] walletBridge.connect completed');
}

/**
 * Initiate authentication flow (SIWS)
 * Dispatches intent.authenticate event
 */
export async function authenticate(machine: AuthMachine): Promise<void> {
	machine.dispatch({ type: 'intent.authenticate' });

	// Wait for auth to complete or fail
	// Machine will handle the flow via effects
	return new Promise((resolve, reject) => {
		let attempts = 0;
		const maxAttempts = 100; // 10 seconds timeout

		const checkStatus = () => {
			attempts++;
			const state = machine.getState();

			if (state.status === 'READY') {
				resolve();
			} else if (state.status === 'ERROR' || attempts >= maxAttempts) {
				reject(new Error('Authentication failed or timed out'));
			} else {
				setTimeout(checkStatus, 100);
			}
		};

		setTimeout(checkStatus, 100);
	});
}

const EXPLICIT_DISCONNECT_KEY = 'auth:explicit_disconnect';

/**
 * Check if user explicitly disconnected (should skip auto-reconnect)
 */
export function wasExplicitlyDisconnected(): boolean {
	if (typeof window === 'undefined') return false;
	return localStorage.getItem(EXPLICIT_DISCONNECT_KEY) === 'true';
}

/**
 * Clear the explicit disconnect flag (called on successful manual connect)
 */
export function clearExplicitDisconnect(): void {
	if (typeof window === 'undefined') return;
	localStorage.removeItem(EXPLICIT_DISCONNECT_KEY);
}

/**
 * Logout and optionally disconnect wallet
 * Dispatches intent.logout event
 */
export async function logout(machine: AuthMachine, walletBridge: WalletBridge, hard: boolean = false): Promise<void> {
	machine.dispatch({ type: 'intent.logout', hard, reason: 'user_clicked' });

	// Mark as explicitly disconnected to prevent auto-reconnect on next page load
	if (hard && typeof window !== 'undefined') {
		localStorage.setItem(EXPLICIT_DISCONNECT_KEY, 'true');
	}

	// Wait for logout to complete
	return new Promise((resolve) => {
		setTimeout(async () => {
			if (hard) {
				await walletBridge.explicitDisconnect();
			}
			resolve();
		}, 100);
	});
}

/**
 * Get list of available wallets (explicit + detected)
 */
export function getAvailableWallets(config: HelpersConfig = {}) {
	ensureInitialized(config);

	const explicit = Object.keys(adapters).map((id) => ({
		id,
		name: id.charAt(0).toUpperCase() + id.slice(1),
		icon: `/wallets/${id}.svg`,
		installed: true
	}));

	const detected = detectedWallets.map((w) => ({
		...w,
		installed: true
	}));

	// Deduplicate
	const seen = new Set<string>();
	return [...explicit, ...detected].filter((w) => {
		const normalized = w.id.toLowerCase();
		if (seen.has(normalized)) return false;
		seen.add(normalized);
		return true;
	});
}
