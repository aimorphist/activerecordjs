/**
 * Nonce Generation Endpoint
 * POST /api/wallet/nonce
 *
 * Generates a one-time nonce for wallet authentication.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateOrigin } from '$lib/wallet/server/origin';
import { createNonce } from '$lib/wallet/server/nonce';
import { nonceStore } from '$lib/server/db/stores';

export const POST: RequestHandler = async ({ request }) => {
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
		const { wallet } = body;

		if (!wallet || typeof wallet !== 'string') {
			return json({ error: 'Invalid wallet address' }, { status: 400 });
		}

		// Generate nonce with 5-minute expiration
		const { nonce, issuedAt, expiresAt } = createNonce(5);

		// Save nonce to store
		await nonceStore.save(nonce, wallet, new Date(expiresAt));

		return json({
			nonce,
			issuedAt,
			expiresAt
		});
	} catch (error) {
		console.error('[nonce] Error:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
