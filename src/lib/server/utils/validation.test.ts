import { describe, it, expect } from 'vitest';
import { validateDestinations, DestinationValidationError } from './validation';
import type { Destination } from '$lib/server/types';

describe('validateDestinations', () => {
	const makeDestination = (shareBps: number, address = 'test'): Destination => ({
		address,
		destinationType: 'wallet',
		shareBps
	});

	it('passes for 50/50 split', () => {
		const destinations = [makeDestination(5000), makeDestination(5000)];
		expect(() => validateDestinations(destinations)).not.toThrow();
	});

	it('passes for 100% to single destination', () => {
		const destinations = [makeDestination(10000)];
		expect(() => validateDestinations(destinations)).not.toThrow();
	});

	it('passes for complex split summing to 10000', () => {
		const destinations = [
			makeDestination(3333),
			makeDestination(3333),
			makeDestination(3334)
		];
		expect(() => validateDestinations(destinations)).not.toThrow();
	});

	it('throws for empty destinations', () => {
		expect(() => validateDestinations([])).toThrow(DestinationValidationError);
		expect(() => validateDestinations([])).toThrow('At least one destination required');
	});

	it('throws when sum is less than 10000', () => {
		const destinations = [makeDestination(5000)];
		expect(() => validateDestinations(destinations)).toThrow(DestinationValidationError);
		expect(() => validateDestinations(destinations)).toThrow('must sum to 10000 bps, got 5000');
	});

	it('throws when sum exceeds 10000', () => {
		const destinations = [makeDestination(6000), makeDestination(6000)];
		expect(() => validateDestinations(destinations)).toThrow(DestinationValidationError);
		expect(() => validateDestinations(destinations)).toThrow('must sum to 10000 bps, got 12000');
	});

	it('throws for zero share', () => {
		const destinations = [makeDestination(0), makeDestination(10000)];
		expect(() => validateDestinations(destinations)).toThrow(DestinationValidationError);
		expect(() => validateDestinations(destinations)).toThrow('share must be positive, got 0');
	});

	it('throws for negative share', () => {
		const destinations = [makeDestination(-1000), makeDestination(11000)];
		expect(() => validateDestinations(destinations)).toThrow(DestinationValidationError);
		expect(() => validateDestinations(destinations)).toThrow('share must be positive, got -1000');
	});
});
