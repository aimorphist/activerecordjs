import { describe, it, expect } from 'vitest';
import { ActiveRecordJSError, RecordNotFoundError, ValidationError } from './errors';

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

describe('ValidationError', () => {
	it('creates error with field errors', () => {
		const error = new ValidationError({
			email: ['is invalid', 'is already taken'],
			name: ['is required']
		});

		expect(error.name).toBe('ValidationError');
		expect(error.errors.email).toEqual(['is invalid', 'is already taken']);
		expect(error.errors.name).toEqual(['is required']);
	});

	it('generates descriptive message', () => {
		const error = new ValidationError({
			email: ['is invalid'],
			name: ['is required']
		});

		expect(error.message).toBe('Validation failed: 2 error(s) on 2 field(s)');
	});

	it('creates error for single field via forField()', () => {
		const error = ValidationError.forField('email', 'is invalid');

		expect(error.errors).toEqual({ email: ['is invalid'] });
	});

	it('generates fullMessages array', () => {
		const error = new ValidationError({
			email: ['is invalid'],
			name: ['is required', 'is too short']
		});

		expect(error.fullMessages).toEqual([
			'email is invalid',
			'name is required',
			'name is too short'
		]);
	});

	it('is instanceof ActiveRecordJSError', () => {
		const error = new ValidationError({ email: ['is invalid'] });

		expect(error).toBeInstanceOf(ActiveRecordJSError);
		expect(error).toBeInstanceOf(ValidationError);
	});
});
