import { describe, it, expect } from 'vitest';
import { hash, hashHex, generateId } from './hash';

describe('Hash utilities', () => {
	describe('hash()', () => {
		it('hashes string input', () => {
			const result = hash('hello');
			expect(result).toBeInstanceOf(Uint8Array);
			expect(result.length).toBe(32);
		});

		it('produces consistent output', () => {
			const a = hash('test');
			const b = hash('test');
			expect(a).toEqual(b);
		});

		it('produces different output for different input', () => {
			const a = hashHex('foo');
			const b = hashHex('bar');
			expect(a).not.toEqual(b);
		});
	});

	describe('generateId()', () => {
		it('generates prefixed id', () => {
			const id = generateId('pipe', { foo: 'bar' });
			expect(id).toMatch(/^pipe_[a-f0-9]{12}$/);
		});

		it('produces consistent ids for same input', () => {
			const a = generateId('test', { a: 1, b: 2 });
			const b = generateId('test', { a: 1, b: 2 });
			expect(a).toBe(b);
		});

		it('sorts keys for consistency', () => {
			const a = generateId('test', { b: 2, a: 1 });
			const b = generateId('test', { a: 1, b: 2 });
			expect(a).toBe(b);
		});
	});
});
