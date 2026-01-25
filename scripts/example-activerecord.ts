#!/usr/bin/env bun
/**
 * Example script demonstrating ActiveRecordJS with validations.
 * Run with: bun scripts/example-activerecord.ts
 */

import { runScript } from './lib/bootstrap';
import { Model, ValidationError, z } from '../src/lib/activerecordjs';
import { usersTable, postsTable } from '../src/lib/activerecordjs/fixtures/schema';

// --- Define Models with Validations ---

class User extends Model(usersTable) {
	static validations = {
		email: z.string().email('must be a valid email'),
		name: z.string().min(1, 'is required').optional(),
		$custom: [
			(user: any) => {
				if (user.email?.endsWith('@banned.com')) {
					throw ValidationError.forField('email', 'domain is not allowed');
				}
			}
		]
	};
}

class Post extends Model(postsTable) {
	static validations = {
		title: z.string().min(1, 'is required'),
		body: z.string().min(10, 'must be at least 10 characters').optional()
	};
}

// --- Main ---

async function main() {
	console.log('\n=== ActiveRecordJS Example ===\n');

	// 1. Validation demo (without saving)
	console.log('1. Validation Demo');
	console.log('-------------------');

	const invalidUser = User.build({ email: 'not-an-email' });
	console.log(`Invalid email - isValid(): ${invalidUser.isValid()}`);
	console.log(`Errors:`, invalidUser.errors);

	const bannedUser = User.build({ email: 'test@banned.com' });
	console.log(`\nBanned domain - isValid(): ${bannedUser.isValid()}`);
	console.log(`Errors:`, bannedUser.errors);

	const validUser = User.build({ email: 'duke@example.com', name: 'Duke' });
	console.log(`\nValid user - isValid(): ${validUser.isValid()}`);
	console.log(`Errors:`, validUser.errors);

	// 2. Create and save a user
	console.log('\n2. Create User');
	console.log('---------------');

	try {
		const user = await User.create({ email: 'demo@example.com', name: 'Demo User' });
		console.log(`Created user with id: ${user.id}`);
		console.log(`  email: ${user.email}`);
		console.log(`  name: ${user.name}`);
		console.log(`  createdAt: ${user.createdAt}`);

		// 3. Find and update
		console.log('\n3. Find and Update');
		console.log('-------------------');

		const found = await User.find(user.id);
		console.log(`Found user: ${found.name} <${found.email}>`);

		await found.update({ name: 'Updated Name' });
		console.log(`Updated name to: ${found.name}`);

		// 4. Query methods
		console.log('\n4. Query Methods');
		console.log('-----------------');

		const allUsers = await User.all();
		console.log(`Total users: ${allUsers.length}`);

		const firstUser = await User.first();
		console.log(`First user: ${firstUser?.email}`);

		const byEmail = await User.findBy({ email: 'demo@example.com' });
		console.log(`Find by email: ${byEmail?.name}`);

		const count = await User.count();
		console.log(`User count: ${count}`);

		// 5. Validation on save (should fail)
		console.log('\n5. Validation on Save');
		console.log('----------------------');

		try {
			await User.create({ email: 'invalid-email' });
		} catch (e) {
			if (e instanceof ValidationError) {
				console.log('Create with invalid email rejected!');
				console.log(`  Error: ${e.message}`);
				console.log(`  Fields: ${JSON.stringify(e.errors)}`);
			}
		}

		// 6. Skip validation (escape hatch)
		console.log('\n6. Skip Validation');
		console.log('-------------------');

		const skipped = await User.create({ email: 'not-valid' }, { validate: false });
		console.log(`Created with validate:false - id: ${skipped.id}, email: ${skipped.email}`);

		// 7. Cleanup
		console.log('\n7. Cleanup');
		console.log('-----------');

		await user.destroy();
		console.log(`Deleted user ${user.id}`);

		await skipped.destroy();
		console.log(`Deleted user ${skipped.id}`);

		console.log('\n=== Done ===\n');
	} catch (e: any) {
		console.error('Error:', e.message);
		if (e.message.includes('does not exist')) {
			console.error('\nHint: Make sure the users table exists. Run migrations or:');
			console.error('  bun run db:push');
		}
	}

}

runScript(main);
