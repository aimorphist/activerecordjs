/**
 * Session Establishment Endpoint
 * POST /api/wallet/establish
 *
 * Verifies SIWS signature and creates an authenticated session.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateOrigin } from '$lib/wallet/server/origin';
import { verifySIWSMessage } from '$lib/wallet/server/siws';
import { validateAndConsumeNonce } from '$lib/wallet/server/nonce';
import { createSession } from '$lib/wallet/server/session';
import { nonceStore, sessionStore, userStore } from '$lib/server/db/stores';

const COOKIE_NAME = 'wallet_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

export const POST: RequestHandler = async ({ request, cookies }) => {
	// Validate origin for security
	const origin = request.headers.get('origin');
	const referer = request.headers.get('referer');
	const host = request.headers.get('host');

	const originError = validateOrigin(origin, referer, host);
	if (originError) {
		return json({ error: originError.error }, { status: originError.status });
	}

	try {
		// Parse request body
		const body = await request.json();
		const { pubkey, nonce, signature, issuedAt, expiresAt } = body;

		if (!pubkey || !nonce || !signature) {
			return json({ error: 'Missing required fields' }, { status: 400 });
		}

		// Validate and consume nonce
		const isNonceValid = await validateAndConsumeNonce(nonceStore, nonce, pubkey);
		if (!isNonceValid) {
			return json({ error: 'Invalid or expired nonce' }, { status: 401 });
		}

		// Verify SIWS signature
		const domain = host || 'localhost';
		const uri = origin || `https://${domain}`;

		const isSignatureValid = await verifySIWSMessage({
			domain,
			address: pubkey,
			uri,
			nonce,
			issuedAt,
			expiresAt,
			signature
		});

		if (!isSignatureValid) {
			return json({ error: 'Invalid signature' }, { status: 401 });
		}

		// Get or create user
		const user = await userStore.findOrCreate(pubkey);

		// Create session
		const { session, cookieValue } = createSession(user.id, pubkey, 30);

		// Save session to store
		await sessionStore.create(session);

		// Set HttpOnly cookie
		cookies.set(COOKIE_NAME, cookieValue, {
			httpOnly: true,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			maxAge: SESSION_MAX_AGE,
			path: '/'
		});

		return json({
			userId: user.id,
			walletAddress: pubkey,
			expiresAt: session.expiresAt.toISOString()
		});
	} catch (error) {
		console.error('[establish] Error:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
