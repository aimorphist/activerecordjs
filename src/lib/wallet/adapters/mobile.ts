/**
 * Mobile wallet detection and deep link utilities
 * Handles mobile-specific wallet connection flows
 */

// Type definitions for wallet providers on window object
interface WindowWithWallets extends Window {
	phantom?: {
		solana?: unknown;
	};
	solflare?: {
		isSolflare?: boolean;
	};
	backpack?: {
		isBackpack?: boolean;
	};
	glow?: unknown;
	ultimate?: unknown;
}

declare const window: WindowWithWallets;

const browser = typeof window !== 'undefined';

export interface WalletDeepLink {
	id: string;
	name: string;
	universalLink: string;
	appStoreUrl: string;
	playStoreUrl: string;
}

/**
 * Deep link configurations for major Solana wallets
 */
export const WALLET_DEEP_LINKS: Record<string, WalletDeepLink> = {
	phantom: {
		id: 'phantom',
		name: 'Phantom',
		universalLink: 'https://phantom.app/ul/browse/',
		appStoreUrl: 'https://apps.apple.com/app/phantom-solana-wallet/id1598432977',
		playStoreUrl: 'https://play.google.com/store/apps/details?id=app.phantom'
	},
	solflare: {
		id: 'solflare',
		name: 'Solflare',
		universalLink: 'https://solflare.com/ul/browse/',
		appStoreUrl: 'https://apps.apple.com/app/solflare/id1580902717',
		playStoreUrl: 'https://play.google.com/store/apps/details?id=com.solflare.mobile'
	},
	backpack: {
		id: 'backpack',
		name: 'Backpack',
		universalLink: 'https://backpack.app/',
		appStoreUrl: 'https://apps.apple.com/app/backpack-crypto-wallet/id6448392770',
		playStoreUrl: 'https://play.google.com/store/apps/details?id=app.backpack.mobile'
	},
	ultimate: {
		id: 'ultimate',
		name: 'Ultimate',
		universalLink: 'https://ultimate.app/',
		appStoreUrl: 'https://apps.apple.com/app/ultimate-wallet/id6443949732',
		playStoreUrl: 'https://play.google.com/store/apps/details?id=com.ultimate.wallet'
	},
	glow: {
		id: 'glow',
		name: 'Glow',
		universalLink: 'https://glow.app/',
		appStoreUrl: 'https://apps.apple.com/app/glow-solana-wallet/id1599584512',
		playStoreUrl: 'https://play.google.com/store/apps/details?id=com.luma.wallet.prod'
	}
};

/**
 * Detect if user is on mobile device
 */
export function isMobileDevice(): boolean {
	if (!browser) return false;
	return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

/**
 * Detect if user is on iOS
 */
export function isIOSDevice(): boolean {
	if (!browser) return false;
	return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Detect if user is on Android
 */
export function isAndroidDevice(): boolean {
	if (!browser) return false;
	return /Android/i.test(navigator.userAgent);
}

/**
 * Get the appropriate app store URL for the current platform
 */
export function getAppStoreUrl(walletId: string): string | null {
	const deepLink = WALLET_DEEP_LINKS[walletId];
	if (!deepLink) return null;

	if (isIOSDevice()) {
		return deepLink.appStoreUrl;
	} else if (isAndroidDevice()) {
		return deepLink.playStoreUrl;
	}
	return null;
}

/**
 * Open wallet app via deep link with current dApp URL
 * This opens the wallet's in-app browser with your dApp loaded
 */
export function openWalletApp(walletId: string): boolean {
	if (!browser) return false;

	const deepLink = WALLET_DEEP_LINKS[walletId];
	if (!deepLink) return false;

	try {
		const currentUrl = encodeURIComponent(window.location.href);
		const deepLinkUrl = `${deepLink.universalLink}${currentUrl}`;

		console.log(`[mobile-utils] Opening ${deepLink.name} app with deep link:`, deepLinkUrl);
		window.location.href = deepLinkUrl;
		return true;
	} catch (error) {
		console.error(`[mobile-utils] Failed to open ${walletId} app:`, error);
		return false;
	}
}

/**
 * Attempt to detect if a wallet app is installed via deep link test
 * Returns a promise that resolves to true if wallet appears to be installed
 *
 * Note: This is a best-effort detection and may not work on all platforms
 */
export async function testWalletInstalled(walletId: string): Promise<boolean> {
	if (!browser || !isMobileDevice()) return false;

	const deepLink = WALLET_DEEP_LINKS[walletId];
	if (!deepLink) return false;

	return new Promise((resolve) => {
		// Create a hidden iframe to test the deep link
		const iframe = document.createElement('iframe');
		iframe.style.display = 'none';

		let resolved = false;
		const timeout = setTimeout(() => {
			if (!resolved) {
				resolved = true;
				document.body.removeChild(iframe);
				// If we timeout, assume wallet is not installed
				resolve(false);
			}
		}, 1000);

		// If the deep link opens successfully, the page will blur
		const handleBlur = () => {
			if (!resolved) {
				resolved = true;
				clearTimeout(timeout);
				document.body.removeChild(iframe);
				resolve(true);
			}
		};

		window.addEventListener('blur', handleBlur, { once: true });

		// Try to open the deep link
		iframe.src = deepLink.universalLink;
		document.body.appendChild(iframe);
	});
}

/**
 * Open app store for wallet installation
 */
export function openAppStore(walletId: string): boolean {
	if (!browser) return false;

	const url = getAppStoreUrl(walletId);
	if (!url) return false;

	try {
		window.open(url, '_blank');
		return true;
	} catch (error) {
		console.error(`[mobile-utils] Failed to open app store for ${walletId}:`, error);
		return false;
	}
}

/**
 * Get user-friendly instructions for connecting a wallet on mobile
 */
export function getMobileConnectionInstructions(walletId: string): string {
	const deepLink = WALLET_DEEP_LINKS[walletId];
	if (!deepLink) return '';

	return `To connect ${deepLink.name}:\n1. Open your ${deepLink.name} app\n2. Navigate to the browser or dApps section\n3. Enter this URL: ${window.location.origin}\n4. Connect your wallet from within the app`;
}

/**
 * Detect if we're currently inside a wallet's in-app browser
 * Checks for wallet-specific global objects that indicate the wallet's provider is available
 */
export function isInsideWalletBrowser(): { isInside: boolean; walletId?: string; walletName?: string } {
	if (!browser) return { isInside: false };

	// Check for Phantom's mobile provider
	if (typeof window !== 'undefined' && window.phantom?.solana) {
		return { isInside: true, walletId: 'phantom', walletName: 'Phantom' };
	}

	// Check for Solflare's mobile provider
	if (typeof window !== 'undefined' && window.solflare?.isSolflare) {
		return { isInside: true, walletId: 'solflare', walletName: 'Solflare' };
	}

	// Check for Backpack's provider
	if (typeof window !== 'undefined' && window.backpack?.isBackpack) {
		return { isInside: true, walletId: 'backpack', walletName: 'Backpack' };
	}

	// Check for Glow's provider
	if (typeof window !== 'undefined' && window.glow) {
		return { isInside: true, walletId: 'glow', walletName: 'Glow' };
	}

	// Check for Ultimate's provider
	if (typeof window !== 'undefined' && window.ultimate) {
		return { isInside: true, walletId: 'ultimate', walletName: 'Ultimate' };
	}

	return { isInside: false };
}

/**
 * Check if a specific wallet's provider is available (installed and injected)
 * This is more reliable than deep link testing on mobile
 */
export function isWalletProviderAvailable(walletId: string): boolean {
	if (!browser) return false;

	switch (walletId) {
		case 'phantom':
			return typeof window !== 'undefined' && !!window.phantom?.solana;
		case 'solflare':
			return typeof window !== 'undefined' && !!window.solflare;
		case 'backpack':
			return typeof window !== 'undefined' && !!window.backpack;
		case 'glow':
			return typeof window !== 'undefined' && !!window.glow;
		case 'ultimate':
			return typeof window !== 'undefined' && !!window.ultimate;
		default:
			return false;
	}
}
