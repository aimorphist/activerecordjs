// Session management interfaces and utilities

import { createHash, randomBytes } from 'crypto';

export interface WalletSession {
	id: string;
	secretHash: string;
	userId: string;
	walletAddress: string;
	expiresAt: Date;
	createdAt: Date;
}

export interface SessionStore {
	create(session: Omit<WalletSession, 'createdAt'>): Promise<void>;
	get(sessionId: string): Promise<WalletSession | null>;
	delete(sessionId: string): Promise<void>;
	deleteByUserId(userId: string): Promise<void>;
}

/**
 * Create a new session with a random ID and secret
 * @param userId The user ID to associate with the session
 * @param walletAddress The wallet address
 * @param expiresInDays Number of days until the session expires (default: 30)
 * @returns Session data and cookie value
 */
export function createSession(
	userId: string,
	walletAddress: string,
	expiresInDays: number = 30
): {
	session: Omit<WalletSession, 'createdAt'>;
	cookieValue: string;
	secret: string;
} {
	const sessionId = randomBytes(32).toString('base64url');
	const secret = randomBytes(32).toString('base64url');
	const secretHash = createHash('sha256').update(secret).digest('base64url');

	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + expiresInDays);

	const session = {
		id: sessionId,
		secretHash,
		userId,
		walletAddress,
		expiresAt
	};

	// Cookie value format: {sessionId}.{secret}
	const cookieValue = `${sessionId}.${secret}`;

	return { session, cookieValue, secret };
}

/**
 * Parse a session cookie value
 * @param cookieValue The cookie value to parse
 * @returns Object with sessionId and secret, or null if invalid
 */
export function parseSessionCookie(cookieValue: string): { sessionId: string; secret: string } | null {
	const parts = cookieValue.split('.');
	if (parts.length !== 2) {
		return null;
	}

	const [sessionId, secret] = parts;
	if (!sessionId || !secret) {
		return null;
	}

	return { sessionId, secret };
}

/**
 * Validate a session cookie
 * @param store SessionStore implementation
 * @param cookieValue The cookie value to validate
 * @returns Session data if valid, null otherwise
 */
export async function validateSession(
	store: SessionStore,
	cookieValue: string
): Promise<{ userId: string; walletAddress: string; expiresAt: Date } | null> {
	const parsed = parseSessionCookie(cookieValue);
	if (!parsed) {
		return null;
	}

	const { sessionId, secret } = parsed;

	// Get session from store
	const session = await store.get(sessionId);
	if (!session) {
		return null;
	}

	// Verify secret hash
	const secretHash = createHash('sha256').update(secret).digest('base64url');
	if (secretHash !== session.secretHash) {
		return null;
	}

	// Check expiration
	if (Date.now() >= session.expiresAt.getTime()) {
		// Session expired, clean it up
		await store.delete(sessionId);
		return null;
	}

	return {
		userId: session.userId,
		walletAddress: session.walletAddress,
		expiresAt: session.expiresAt
	};
}

/**
 * Invalidate a session
 * @param store SessionStore implementation
 * @param cookieValue The cookie value to invalidate
 */
export async function invalidateSession(store: SessionStore, cookieValue: string): Promise<void> {
	const parsed = parseSessionCookie(cookieValue);
	if (!parsed) {
		return;
	}

	await store.delete(parsed.sessionId);
}
