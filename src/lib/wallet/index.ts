// Main wallet library exports

// Core (framework-agnostic)
export * from './core';

// Adapters - explicitly avoid re-exporting WalletBridge type (conflicts with core)
export {
	createWalletBridge,
	createSessionManager,
	type SessionManagerConfig,
	createSystemBridge,
	type SystemBridge,
	type WalletId,
	createAdapters,
	detectWalletStandardWallets,
	createDetectedWalletAdapter,
	type DetectedWallet,
	isMobileDevice,
	isIOSDevice,
	isAndroidDevice,
	getAppStoreUrl,
	openWalletApp,
	testWalletInstalled,
	openAppStore,
	getMobileConnectionInstructions,
	isInsideWalletBrowser,
	isWalletProviderAvailable,
	type WalletDeepLink,
	WALLET_DEEP_LINKS
} from './adapters';

// Svelte integration
export * from './svelte';

// Server-side (import from 'wallet/server' separately to avoid bundling in client)
