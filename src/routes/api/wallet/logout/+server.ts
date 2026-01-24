/**
 * Logout Endpoint
 * POST /api/wallet/logout
 *
 * Invalidates the current session and clears the session cookie.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { invalidateSession } from '$lib/wallet/server/session';
import { sessionStore } from '$lib/server/db/stores';

const COOKIE_NAME = 'wallet_session';

export const POST: RequestHandler = async ({ cookies }) => {
	try {
		// Get session cookie
		const sessionCookie = cookies.get(COOKIE_NAME);

		if (sessionCookie) {
			// Invalidate session in database
			await invalidateSession(sessionStore, sessionCookie);
		}

		// Clear session cookie
		cookies.delete(COOKIE_NAME, {
			path: '/'
		});

		return json({ success: true });
	} catch (error) {
		console.error('[logout] Error:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
