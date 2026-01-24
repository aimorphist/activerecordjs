// Session manager - factory function (no classes)

import type { SessionManager } from '../core/commands';

export interface SessionManagerConfig {
	baseUrl?: string;
	paths?: {
		session?: string;
		nonce?: string;
		establish?: string;
		logout?: string;
	};
}

export function createSessionManager(config: SessionManagerConfig = {}): SessionManager {
	const baseUrl = config.baseUrl || '';
	const paths = {
		session: config.paths?.session || '/api/wallet/session',
		nonce: config.paths?.nonce || '/api/wallet/nonce',
		establish: config.paths?.establish || '/api/wallet/establish',
		logout: config.paths?.logout || '/api/wallet/logout'
	};

	async function hydrate() {
		// In SSR/tests there is no browser session/cookies; skip network call to avoid noisy errors
		if (typeof window === 'undefined') {
			return { established: false };
		}
		try {
			const res = await fetch(`${baseUrl}${paths.session}`, {
				credentials: 'include'
			});
			if (!res.ok) return { established: false };
			const data = await res.json();
			return {
				established: !!data.userId,
				userId: data.userId,
				walletPubkey: data.walletAddress,
				expiresAt: data.expiresAt
			};
		} catch (error) {
			console.error('[SessionManager] Hydration failed:', error);
			return { established: false };
		}
	}

	async function getNonce(pubkey: string) {
		const res = await fetch(`${baseUrl}${paths.nonce}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ wallet: pubkey })
		});
		if (!res.ok) {
			const bodyText = await res.text().catch(() => '');
			const error = new Error(`Failed to get nonce: ${bodyText || res.statusText}`) as Error & {
				status?: number;
				code?: string;
			};
			error.status = res.status;
			error.code =
				res.status === 401 ? 'UNAUTHORIZED' : res.status === 403 ? 'FORBIDDEN' : 'NONCE_FAILED';
			throw error;
		}
		return await res.json();
	}

	async function establish(input: {
		pubkey: string;
		nonce: string;
		signature: string;
		adapterId?: string;
	}) {
		const res = await fetch(`${baseUrl}${paths.establish}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				pubkey: input.pubkey,
				nonce: input.nonce,
				signature: input.signature,
				adapterId: input.adapterId
			})
		});
		if (!res.ok) {
			const bodyText = await res.text().catch(() => '');
			const error = new Error(
				`Failed to establish session: ${bodyText || res.statusText}`
			) as Error & { status?: number; code?: string };
			error.status = res.status;
			error.code =
				res.status === 401 ? 'UNAUTHORIZED' : res.status === 403 ? 'FORBIDDEN' : 'ESTABLISH_FAILED';
			throw error;
		}
		const data = await res.json();
		return {
			userId: data.userId,
			walletPubkey: data.walletAddress,
			expiresAt: data.expiresAt
		};
	}

	async function invalidate(reason?: string, hard?: boolean) {
		const res = await fetch(`${baseUrl}${paths.logout}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ reason, hard })
		});
		if (!res.ok) {
			const err = await res.text();
			throw new Error(`Failed to invalidate session: ${err}`);
		}
	}

	return {
		hydrate,
		getNonce,
		establish,
		invalidate
	};
}
