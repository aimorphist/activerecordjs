// Wallet adapter factory

import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import type { Adapter } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';

// WalletId can be explicit adapters or any Wallet Standard wallet
export type WalletId = 'phantom' | 'solflare' | 'backpack' | string;

/**
 * Creates wallet adapters for explicit wallets (Phantom, Solflare, Backpack)
 * Wallet Standard wallets are detected separately via getWallets()
 */
export function createAdapters(): Record<WalletId, Adapter> {
	return {
		phantom: new PhantomWalletAdapter(),
		solflare: new SolflareWalletAdapter(),
		backpack: new BackpackWalletAdapter()
	};
}
