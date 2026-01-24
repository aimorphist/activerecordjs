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
