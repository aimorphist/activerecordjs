// Nonce generation and validation

import { generateNonce, getNonceExpiration } from '../core/siws';

export interface NonceStore {
	save(nonce: string, walletAddress: string, expiresAt: Date): Promise<void>;
	get(nonce: string): Promise<{ walletAddress: string; expiresAt: Date } | null>;
	consume(nonce: string): Promise<boolean>;
}

/**
 * Generate a new nonce with expiration time
 * @param minutes Expiration time in minutes (default: 5)
 * @returns Object with nonce, issuedAt, and expiresAt timestamps
 */
export function createNonce(minutes: number = 5): {
	nonce: string;
	issuedAt: string;
	expiresAt: string;
} {
	const nonce = generateNonce();
	const issuedAt = new Date();
	const expiresAt = getNonceExpiration(minutes);

	return {
		nonce,
		issuedAt: issuedAt.toISOString(),
		expiresAt: expiresAt.toISOString()
	};
}

/**
 * Validate and consume a nonce
 * @param store NonceStore implementation
 * @param nonce The nonce to validate
 * @param walletAddress Expected wallet address
 * @returns True if the nonce is valid and not consumed
 */
export async function validateAndConsumeNonce(
	store: NonceStore,
	nonce: string,
	walletAddress: string
): Promise<boolean> {
	const nonceData = await store.get(nonce);
	if (!nonceData) {
		return false; // Nonce not found
	}

	// Check wallet address match
	if (nonceData.walletAddress !== walletAddress) {
		return false; // Nonce belongs to different wallet
	}

	// Check expiration
	if (Date.now() >= nonceData.expiresAt.getTime()) {
		return false; // Nonce expired
	}

	// Consume the nonce (mark as used)
	return await store.consume(nonce);
}
