import { describe, it, expect } from 'vitest';
import { createDecider, UnknownDeciderTypeError } from './registry';
import { StaticDecider } from './static';
import type { Destination } from '$lib/server/types';

const makeDestination = (shareBps: number): Destination => ({
	address: 'test-address',
	destinationType: 'wallet',
	shareBps
});

describe('createDecider', () => {
	it('creates StaticDecider for type static', () => {
		const destinations = [makeDestination(5000), makeDestination(5000)];
		const decider = createDecider('static', {}, destinations);

		expect(decider).toBeInstanceOf(StaticDecider);
		expect(decider.type).toBe('static');
	});

	it('throws for lambda (not yet implemented)', () => {
		const destinations = [makeDestination(10000)];

		expect(() => createDecider('lambda', {}, destinations)).toThrow(UnknownDeciderTypeError);
		expect(() => createDecider('lambda', {}, destinations)).toThrow('lambda not yet implemented');
	});

	it('throws for unknown type', () => {
		const destinations = [makeDestination(10000)];

		// @ts-expect-error testing invalid type
		expect(() => createDecider('unknown', {}, destinations)).toThrow(UnknownDeciderTypeError);
		// @ts-expect-error testing invalid type
		expect(() => createDecider('unknown', {}, destinations)).toThrow('Unknown decider type: unknown');
	});
});
