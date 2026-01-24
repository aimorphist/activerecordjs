import { blake3 } from '@noble/hashes/blake3.js';

export function hash(data: string | Uint8Array): Uint8Array {
	const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
	return blake3(input);
}

export function hashHex(data: string | Uint8Array): string {
	return Buffer.from(hash(data)).toString('hex');
}

export function generateId(prefix: string, data: Record<string, unknown>): string {
	const canonical = JSON.stringify(data, Object.keys(data).sort());
	const hashStr = hashHex(canonical).slice(0, 12);
	return `${prefix}_${hashStr}`;
}
