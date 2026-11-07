export class ActiveRecordJSError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ActiveRecordJSError';
	}
}

export class RecordNotFoundError extends ActiveRecordJSError {
	constructor(modelName: string, id: unknown) {
		super(`${modelName} with id ${id} not found`);
		this.name = 'RecordNotFoundError';
	}
}

export class ValidationError extends ActiveRecordJSError {
	readonly errors: Record<string, string[]>;

	constructor(errors: Record<string, string[]>) {
		const fieldCount = Object.keys(errors).length;
		const errorCount = Object.values(errors).flat().length;
		const message = `Validation failed: ${errorCount} error(s) on ${fieldCount} field(s)`;
		super(message);
		this.name = 'ValidationError';
		this.errors = errors;
	}

	/**
	 * Add an error for a specific field
	 */
	static forField(field: string, message: string): ValidationError {
		return new ValidationError({ [field]: [message] });
	}

	/**
	 * Get all error messages as a flat array
	 */
	get fullMessages(): string[] {
		return Object.entries(this.errors).flatMap(([field, messages]) =>
			messages.map((msg) => `${field} ${msg}`)
		);
	}
}

export class DependentRestrictError extends ActiveRecordJSError {
	constructor(modelName: string, associationName: string) {
		super(
			`Cannot destroy ${modelName}: dependent '${associationName}' records exist (restrict)`
		);
		this.name = 'DependentRestrictError';
	}
}

/** No captured scope and no ambient scope: thrown before any driver call. */
export class NoConnectionScopeError extends ActiveRecordJSError {
	constructor() {
		super(
			'No connection scope. Use scope.model(table) from core, or bind one on Node with createActiveRecordJS(db) / runWithConnection(db, fn) from the node entry.'
		);
		this.name = 'NoConnectionScopeError';
	}
}

/** Work on a scope after close() or after its transaction lease retired. */
export class ScopeClosedError extends ActiveRecordJSError {
	constructor(reason: string) {
		super(`Connection scope is not usable: ${reason}`);
		this.name = 'ScopeClosedError';
	}
}

/** transaction() on a callback scope, or on a root whose transaction is still open. */
export class TransactionReentryError extends ActiveRecordJSError {
	constructor(reason: string) {
		super(`Nested transaction rejected: ${reason}. No flatten, no savepoint.`);
		this.name = 'TransactionReentryError';
	}
}
