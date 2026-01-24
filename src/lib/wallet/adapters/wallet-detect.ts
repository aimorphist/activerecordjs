/**
 * Wallet Standard detection utility
 * Detects wallets that implement the Wallet Standard protocol at runtime
 *
 * Story 3.2: AC1 - Auto-detect Wallet Standard compliant wallets
 */

import { getWallets } from '@wallet-standard/app';

export interface DetectedWallet {
	id: string;
	name: string;
	installed: boolean;
}

const browser = typeof window !== 'undefined';

/**
 * Detect Wallet Standard wallets from the browser environment
 * Uses the official Wallet Standard protocol to detect ALL compliant wallets
 * including MetaMask, Backpack, Glow, and any future Solana wallets
 *
 * @returns Array of detected wallets with id, name, and installed status
 */
export function detectWalletStandardWallets(): DetectedWallet[] {
	if (!browser) return [];

	try {
		const detected: DetectedWallet[] = [];
		const seenIds = new Set<string>();

		// Use the official Wallet Standard API to get all registered wallets
		const wallets = getWallets();
		const standardWallets = wallets.get();

		for (const wallet of standardWallets) {
			// Check if wallet supports Solana chains
			const supportsSolana = (wallet as any).chains.some(
				(chain: any) => chain.startsWith('solana:')
			);

			if (supportsSolana) {
				// Extract wallet ID from name (lowercase, remove spaces)
				const walletId = (wallet as any).name.toLowerCase().replace(/\s+/g, '');

				// Deduplicate: Some wallets (like MetaMask) register themselves multiple times
				if (!seenIds.has(walletId)) {
					seenIds.add(walletId);
					detected.push({
						id: walletId,
						name: (wallet as any).name,
						installed: true // If it's registered, it's installed
					});
				}
			}
		}

		console.log('[detect] Found Wallet Standard wallets:', detected.map(w => `${w.name} (${w.id})`));
		return detected;
	} catch (error) {
		console.warn('[detect] Failed to detect Wallet Standard wallets:', error);
		return [];
	}
}

/**
 * Create a standardized wallet adapter for detected wallets
 * This wraps the wallet's native API into the Adapter interface
 *
 * @param walletId The detected wallet ID
 * @returns Wallet adapter or null if wallet not found
 */
export function createDetectedWalletAdapter(walletId: string): any | null {
	if (!browser) return null;

	try {
		// Get the wallet from Wallet Standard registry
		const wallets = getWallets();
		const standardWallets = wallets.get();

		// Find wallet by ID (case-insensitive match)
		const wallet = standardWallets.find(
			(w: any) => w.name.toLowerCase().replace(/\s+/g, '') === walletId
		);

		if (!wallet) {
			console.warn(`[detect] Wallet ${walletId} not found in Wallet Standard registry`);
			return null;
		}

		// Return a Wallet Standard adapter
		// The wallet object already implements the standard interface
		const adapter: any = {
			name: (wallet as any).name,
			icon: (wallet as any).icon,
			publicKey: null, // Will be set after connect
			connected: false,
			_solanaAccount: null, // Store for signMessage
			connect: async () => {
				console.log('[detect] Connecting to wallet:', (wallet as any).name);
				console.log('[detect] Wallet features:', Object.keys((wallet as any).features));

				// Wallet Standard connect - get Solana account
				// Pass {silent: false} to force user interaction popup
				const connectFeature = (wallet as any).features['standard:connect'];
				const result = await connectFeature.connect({ silent: false });
				console.log('[detect] Got result:', result);

				// MetaMask returns {accounts: [...]} instead of just [...]
				const accounts = result.accounts || result;
				console.log('[detect] Extracted accounts array:', accounts);

				const solanaAccount = accounts.find((acc: any) => acc.chains.some((c: any) => c.startsWith('solana:')));
				console.log('[detect] Found Solana account:', solanaAccount);

				// Set publicKey on adapter after successful connection
				if (solanaAccount) {
					adapter.publicKey = {
						toBase58: () => solanaAccount.address
					};
					adapter.connected = true;
					adapter._solanaAccount = solanaAccount; // Store for signMessage
					console.log('[detect] Set publicKey:', solanaAccount.address);
				} else {
					console.warn('[detect] No Solana account found in accounts');
				}

				return solanaAccount;
			},
			disconnect: async () => {
				if ((wallet as any).features['standard:disconnect']) {
					await (wallet as any).features['standard:disconnect'].disconnect();
				}
				adapter._solanaAccount = null;
			},
			signMessage: async (msg: Uint8Array) => {
				if ((wallet as any).features['solana:signMessage']) {
					// Wallet Standard expects {account, message} not just the message
					if (!adapter._solanaAccount) {
						throw new Error('Wallet not connected');
					}
					console.log('[detect] Calling signMessage with:', { account: adapter._solanaAccount, message: msg });
					const result = await (wallet as any).features['solana:signMessage'].signMessage({
						account: adapter._solanaAccount,
						message: msg
					});
					console.log('[detect] signMessage result:', result);

					// MetaMask returns an array of signature results
					const signatureResult = Array.isArray(result) ? result[0] : result;
					console.log('[detect] signatureResult:', signatureResult);
					console.log('[detect] signatureResult.signature:', signatureResult.signature);

					// Return just the signature bytes
					return signatureResult.signature;
				}
				throw new Error('Wallet does not support message signing');
			},
			signTransaction: async (tx: unknown) => {
				if ((wallet as any).features['solana:signTransaction']) {
					return await (wallet as any).features['solana:signTransaction'].signTransaction(tx);
				}
				throw new Error('Wallet does not support transaction signing');
			},
			// Expose the underlying Wallet Standard wallet
			_wallet: wallet
		};

		return adapter;
	} catch (error) {
		console.warn(`[detect] Failed to create adapter for ${walletId}:`, error);
		return null;
	}
}
