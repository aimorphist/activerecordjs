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
