/**
 * Session Status Endpoint
 * GET /api/wallet/session
 *
 * Checks if the current session is valid and returns user info.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateSession } from '$lib/wallet/server/session';
import { sessionStore } from '$lib/server/db/stores';

const COOKIE_NAME = 'wallet_session';

export const GET: RequestHandler = async ({ cookies }) => {
	try {
		// Get session cookie
		const sessionCookie = cookies.get(COOKIE_NAME);

		if (!sessionCookie) {
			return json({ established: false });
		}

		// Validate session
		const session = await validateSession(sessionStore, sessionCookie);

		if (!session) {
			// Invalid or expired session
			cookies.delete(COOKIE_NAME, { path: '/' });
			return json({ established: false });
		}

		return json({
			established: true,
			userId: session.userId,
			walletAddress: session.walletAddress,
			expiresAt: session.expiresAt.toISOString()
		});
	} catch (error) {
		console.error('[session] Error:', error);
		return json({ established: false });
	}
};
