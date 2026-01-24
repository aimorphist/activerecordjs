import { describe, it, expect } from 'vitest';
import { ActiveRecordJSError, RecordNotFoundError } from './errors';

describe('ActiveRecordJSError', () => {
	it('is an instance of Error', () => {
		const error = new ActiveRecordJSError('test');
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('ActiveRecordJSError');
	});

	it('has correct message', () => {
		const error = new ActiveRecordJSError('something went wrong');
		expect(error.message).toBe('something went wrong');
	});
});

describe('RecordNotFoundError', () => {
	it('extends ActiveRecordJSError', () => {
		const error = new RecordNotFoundError('User', 123);
		expect(error).toBeInstanceOf(ActiveRecordJSError);
		expect(error.name).toBe('RecordNotFoundError');
	});

	it('formats message with model name and id', () => {
		const error = new RecordNotFoundError('User', 42);
		expect(error.message).toBe('User with id 42 not found');
	});

	it('handles non-numeric ids', () => {
		const error = new RecordNotFoundError('Post', 'abc-123');
		expect(error.message).toBe('Post with id abc-123 not found');
	});
});
