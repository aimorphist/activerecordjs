import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

// Use tweetnacl for reliable ed25519 signature verification
// This works out-of-box in Node.js without manual crypto configuration

/**
 * Generate a unique nonce for SIWS authentication
 */
export function generateNonce(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return bs58.encode(bytes);
}

/**
 * Create a sign-in message following SIWS pattern
 * Story 3.2: AC7 - Include domain, uri, nonce, issuedAt, expiration ≤ 5m
 */
export function createSignInMessage(params: {
	domain: string;
	address: string;
	uri?: string;
	nonce: string;
	issuedAt: string;
	expiresAt: string;
}): string {
	const uri = params.uri || `https://${params.domain}`;
	return `${params.domain} wants you to sign in with your Solana account:
${params.address}

Sign in with Solana to the app.

URI: ${uri}
Nonce: ${params.nonce}
Issued At: ${params.issuedAt}
Expiration Time: ${params.expiresAt}`;
}

/**
 * Verify a Solana wallet signature
 * @param message - The original message that was signed
 * @param signature - Base58-encoded signature
 * @param publicKey - Wallet public key as base58 string
 * @returns true if signature is valid
 */
export async function verifySignature(
	message: string,
	signature: string,
	publicKey: string
): Promise<boolean> {
	try {
		// CRITICAL: FormData converts \n → \r\n during HTTP transmission per multipart/form-data spec.
		// We must normalize back to \n to match the exact bytes the wallet signed client-side.
		const normalizedMessage = message.replace(/\r\n/g, '\n');

		// Decode the signature and public key from base58
		const signatureBytes = bs58.decode(signature.trim());
		const publicKeyBytes = new PublicKey(publicKey).toBytes();

		// Encode message to bytes
		const messageBytes = new TextEncoder().encode(normalizedMessage);

		// Verify using tweetnacl (works out-of-box, no SHA-512 config needed)
		return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
	} catch (error) {
		console.error('[siws] Signature verification failed:', error);
		return false;
	}
}

/**
 * Calculate expiration time for a nonce (default: 5 minutes)
 */
export function getNonceExpiration(minutes: number = 5): Date {
	return new Date(Date.now() + minutes * 60 * 1000);
}
