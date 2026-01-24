import type { Destination, DeciderConfig } from '$lib/server/types';
import type { Decider } from './types';
import { StaticDecider } from './static';

export class UnknownDeciderTypeError extends Error {
	constructor(type: string) {
		super(`Unknown decider type: ${type}`);
		this.name = 'UnknownDeciderTypeError';
	}
}

export function createDecider(
	type: 'static' | 'lambda',
	_config: DeciderConfig,
	destinations: Destination[]
): Decider {
	switch (type) {
		case 'static':
			return new StaticDecider(destinations);
		case 'lambda':
			throw new UnknownDeciderTypeError('lambda not yet implemented');
		default:
			throw new UnknownDeciderTypeError(type as string);
	}
}
