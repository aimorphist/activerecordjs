// Server-side SIWS verification

import { createSignInMessage, verifySignature } from '../core/siws';

export interface VerifyMessageParams {
	domain: string;
	address: string;
	uri: string;
	nonce: string;
	issuedAt: string;
	expiresAt: string;
	signature: string;
}

/**
 * Verify a SIWS (Sign-In With Solana) message on the server
 * @param params Message parameters to verify
 * @returns True if the signature is valid
 */
export async function verifySIWSMessage(params: VerifyMessageParams): Promise<boolean> {
	// Reconstruct the message that was signed
	const message = createSignInMessage({
		domain: params.domain,
		address: params.address,
		uri: params.uri,
		nonce: params.nonce,
		issuedAt: params.issuedAt,
		expiresAt: params.expiresAt
	});

	// Verify the signature
	return await verifySignature(message, params.signature, params.address);
}

/**
 * Validate nonce expiration
 * @param expiresAt ISO timestamp string
 * @returns True if the nonce has not expired
 */
export function isNonceValid(expiresAt: string): boolean {
	const expirationTime = new Date(expiresAt).getTime();
	const now = Date.now();
	return now < expirationTime;
}
