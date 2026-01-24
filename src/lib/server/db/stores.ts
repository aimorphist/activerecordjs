/**
 * Database store implementations for wallet authentication
 */

import { eq } from 'drizzle-orm';
import { db } from './index';
import { walletUsers, walletSessions, authNonces } from './schema';
import type { SessionStore } from '$lib/wallet/server/session';
import type { NonceStore } from '$lib/wallet/server/nonce';
import { randomBytes } from 'crypto';

/**
 * Drizzle session store implementation
 */
export const sessionStore: SessionStore = {
	async create(session) {
		await db.insert(walletSessions).values({
			id: session.id,
			secretHash: session.secretHash,
			userId: session.userId,
			walletAddress: session.walletAddress,
			expiresAt: session.expiresAt
		});
	},

	async get(sessionId) {
		const rows = await db
			.select()
			.from(walletSessions)
			.where(eq(walletSessions.id, sessionId))
			.limit(1);

		if (!rows[0]) return null;

		return {
			id: rows[0].id,
			secretHash: rows[0].secretHash,
			userId: rows[0].userId,
			walletAddress: rows[0].walletAddress,
			expiresAt: rows[0].expiresAt,
			createdAt: rows[0].createdAt
		};
	},

	async delete(sessionId) {
		await db.delete(walletSessions).where(eq(walletSessions.id, sessionId));
	},

	async deleteByUserId(userId) {
		await db.delete(walletSessions).where(eq(walletSessions.userId, userId));
	}
};

/**
 * Drizzle nonce store implementation
 */
export const nonceStore: NonceStore = {
	async save(nonce, walletAddress, expiresAt) {
		await db.insert(authNonces).values({
			nonce,
			walletAddress,
			expiresAt
		});
	},

	async get(nonce) {
		const rows = await db
			.select()
			.from(authNonces)
			.where(eq(authNonces.nonce, nonce))
			.limit(1);

		if (!rows[0]) return null;

		return {
			walletAddress: rows[0].walletAddress,
			expiresAt: rows[0].expiresAt
		};
	},

	async consume(nonce) {
		const result = await db.delete(authNonces).where(eq(authNonces.nonce, nonce));
		return (result as any).rowCount > 0;
	}
};

/**
 * User store for managing wallet users
 */
export const userStore = {
	async findByWallet(walletAddress: string) {
		const rows = await db
			.select()
			.from(walletUsers)
			.where(eq(walletUsers.walletAddress, walletAddress))
			.limit(1);

		return rows[0] || null;
	},

	async create(data: { walletAddress: string }) {
		const id = randomBytes(16).toString('hex');
		const now = new Date();

		await db.insert(walletUsers).values({
			id,
			walletAddress: data.walletAddress,
			createdAt: now,
			updatedAt: now
		});

		return { id, walletAddress: data.walletAddress, createdAt: now, updatedAt: now };
	},

	async findOrCreate(walletAddress: string) {
		let user = await this.findByWallet(walletAddress);
		if (!user) {
			user = await this.create({ walletAddress });
		}
		return user;
	}
};
