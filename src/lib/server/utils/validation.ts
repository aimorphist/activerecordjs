import type { Destination } from '$lib/server/types';

export class DestinationValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DestinationValidationError';
	}
}

export function validateDestinations(destinations: Destination[]): void {
	if (destinations.length === 0) {
		throw new DestinationValidationError('At least one destination required');
	}

	const totalBps = destinations.reduce((sum, d) => sum + d.shareBps, 0);
	if (totalBps !== 10000) {
		throw new DestinationValidationError(
			`Destinations must sum to 10000 bps, got ${totalBps}`
		);
	}

	for (const dest of destinations) {
		if (dest.shareBps <= 0) {
			throw new DestinationValidationError(
				`Destination share must be positive, got ${dest.shareBps}`
			);
		}
	}
}
