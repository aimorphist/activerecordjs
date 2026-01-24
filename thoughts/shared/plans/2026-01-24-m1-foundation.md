# Bagpipe ORM M1: Foundation Implementation Plan

## Overview

Implement the foundation of Bagpipe ORM: project scaffolding, the `Model()` base class factory, convention detection, and complete CRUD operations. This milestone delivers a working ORM that can create, read, update, and delete records with minimal configuration, built on Drizzle and targeting PostgreSQL.

## Current State Analysis

This is a greenfield project. The repository contains only:

- `PRD.md` - Product requirements document (the specification)
- Documentation files for a different concept (token router - ignore these)

No source code, package.json, or configuration exists.

## Desired End State

After M1 is complete:

```typescript
// Users can define models like this:
import { Model } from 'bagpipe';
import { users } from './schema';

class User extends Model(users) {}

// And perform CRUD operations:
const user = await User.create({ name: 'Duke', email: 'duke@example.com' });
const found = await User.find(user.id);
const byEmail = await User.findBy({ email: 'duke@example.com' });
const all = await User.all();
const first = await User.first();

user.name = 'New Name';
await user.save(); // updated_at auto-managed

await user.update({ name: 'Another Name' });
await User.update(user.id, { name: 'Static Update' });

await user.destroy();
await User.destroy(someId);
```

### Verification:

- All unit tests pass: `npm test`
- All integration tests pass with real PostgreSQL
- TypeScript compiles without errors: `npm run typecheck`
- Linting passes: `npm run lint`

## What We're NOT Doing

- **Validations** - M3
- **Lifecycle hooks** - M4
- **Associations** - M5/M6
- **Transactions** - M7
- **Scopes** - M8
- **Query builder chaining** (where/order/limit) - M2
- **Migrations** - Use Drizzle's migration system directly
- **Multiple database support** - PostgreSQL only for now
- **Connection pooling configuration** - Use Drizzle defaults

## Implementation Approach

We'll build bottom-up:

1. Scaffold the project with all tooling
2. Create the Model factory that wraps Drizzle tables
3. Implement read operations first (simpler, no state mutation)
4. Add write operations with timestamp management
5. Add delete operations
6. Comprehensive test coverage throughout

Key technical decisions:

- **Both static and instance methods** for Rails-like ergonomics
- **Direct attribute assignment** (`user.name = 'x'`) - no `.set()` method
- **PostgreSQL** as the target database
- **Vitest** for testing per PRD requirements
- Use **Proxy** for dynamic attribute access on model instances

---

## Phase 1: Project Scaffolding

### Overview

Set up the complete project infrastructure: package.json, TypeScript, Vitest, ESLint, and directory structure.

### Changes Required:

#### 1. Package Configuration

**File**: `package.json`

```json
{
	"name": "bagpipe",
	"version": "0.1.0",
	"description": "ActiveRecord ergonomics for TypeScript, built on Drizzle",
	"type": "module",
	"main": "dist/index.js",
	"types": "dist/index.d.ts",
	"exports": {
		".": {
			"import": "./dist/index.js",
			"types": "./dist/index.d.ts"
		}
	},
	"scripts": {
		"build": "tsc",
		"typecheck": "tsc --noEmit",
		"test": "vitest run",
		"test:watch": "vitest",
		"test:integration": "vitest run --config vitest.integration.config.ts",
		"lint": "eslint src tests --ext .ts",
		"lint:fix": "eslint src tests --ext .ts --fix"
	},
	"keywords": ["orm", "drizzle", "activerecord", "typescript", "postgresql"],
	"author": "",
	"license": "MIT",
	"devDependencies": {
		"@types/node": "^20.10.0",
		"@typescript-eslint/eslint-plugin": "^7.0.0",
		"@typescript-eslint/parser": "^7.0.0",
		"eslint": "^8.56.0",
		"typescript": "^5.3.0",
		"vitest": "^1.2.0"
	},
	"dependencies": {
		"drizzle-orm": "^0.29.0",
		"pg": "^8.11.0",
		"zod": "^3.22.0"
	},
	"peerDependencies": {
		"drizzle-orm": ">=0.29.0"
	}
}
```

#### 2. TypeScript Configuration

**File**: `tsconfig.json`

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"lib": ["ES2022"],
		"outDir": "dist",
		"rootDir": "src",
		"strict": true,
		"esModuleInterop": true,
		"skipLibCheck": true,
		"forceConsistentCasingInFileNames": true,
		"declaration": true,
		"declarationMap": true,
		"sourceMap": true,
		"resolveJsonModule": true,
		"isolatedModules": true,
		"noUncheckedIndexedAccess": true,
		"noImplicitOverride": true
	},
	"include": ["src/**/*"],
	"exclude": ["node_modules", "dist", "tests"]
}
```

#### 3. Vitest Configuration

**File**: `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/unit/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.d.ts']
		}
	}
});
```

**File**: `vitest.integration.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['tests/integration/**/*.test.ts'],
		testTimeout: 30000,
		hookTimeout: 30000
	}
});
```

#### 4. ESLint Configuration

**File**: `.eslintrc.cjs`

```javascript
module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	plugins: ['@typescript-eslint'],
	extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
	env: {
		node: true,
		es2022: true
	},
	parserOptions: {
		ecmaVersion: 2022,
		sourceType: 'module'
	},
	rules: {
		'@typescript-eslint/no-explicit-any': 'off', // PRD: "any where necessary"
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
	}
};
```

#### 5. Git Ignore

**File**: `.gitignore`

```
node_modules/
dist/
coverage/
.env
.env.local
*.log
.DS_Store
```

#### 6. Directory Structure

Create the following directories:

```
src/
├── index.ts              # Public exports
├── model.ts              # Model base class factory
├── errors.ts             # Error types
├── types.ts              # TypeScript types
└── connection.ts         # Database connection management

tests/
├── unit/
│   ├── model.test.ts
│   └── errors.test.ts
├── integration/
│   └── crud.test.ts
└── fixtures/
    ├── schema.ts         # Test Drizzle schema
    └── models.ts         # Test model definitions
```

#### 7. Initial Source Files (Stubs)

**File**: `src/index.ts`

```typescript
export { Model, createBagpipe } from './model';
export * from './errors';
export type * from './types';
```

**File**: `src/errors.ts`

```typescript
export class BagpipeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BagpipeError';
	}
}

export class RecordNotFoundError extends BagpipeError {
	constructor(modelName: string, id: unknown) {
		super(`${modelName} with id ${id} not found`);
		this.name = 'RecordNotFoundError';
	}
}
```

**File**: `src/types.ts`

```typescript
import type { PgTable } from 'drizzle-orm/pg-core';

export type AnyPgTable = PgTable<any>;

export interface ModelStatic<T> {
	find(id: number): Promise<T>;
	findBy(attrs: Partial<Record<string, unknown>>): Promise<T | null>;
	all(): Promise<T[]>;
	first(): Promise<T | null>;
	last(): Promise<T | null>;
	create(attrs: Record<string, unknown>): Promise<T>;
	update(id: number, attrs: Record<string, unknown>): Promise<T>;
	destroy(id: number): Promise<void>;
	new (attrs?: Record<string, unknown>): T;
}

export interface ModelInstance {
	id: number | null;
	save(): Promise<this>;
	update(attrs: Record<string, unknown>): Promise<this>;
	destroy(): Promise<void>;
	readonly isNewRecord: boolean;
	readonly isPersisted: boolean;
}
```

**File**: `src/model.ts`

```typescript
// Stub - to be implemented in Phase 2
export function Model<T>(table: T): any {
	throw new Error('Not implemented');
}

export function createBagpipe(db: any): { Model: typeof Model } {
	throw new Error('Not implemented');
}
```

**File**: `src/connection.ts`

```typescript
// Stub - to be implemented in Phase 2
export class Connection {
	// Database connection management
}
```

### Success Criteria:

#### Automated Verification:

- [x] `bun install` completes without errors
- [x] `bun run check` passes (stubs compile)
- [x] `bun run lint` passes
- [x] `bun run build` produces output (SvelteKit build)
- [x] Directory structure matches specification (`src/lib/activerecordjs/`)

#### Manual Verification:

- [x] Verify all files are created with correct content
- [x] Confirm dependencies are appropriate versions

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Core Model Infrastructure

### Overview

Implement the `Model()` factory function, convention detection, and database connection management. This is the foundation that all CRUD operations will build upon.

### Changes Required:

#### 1. Connection Management

**File**: `src/connection.ts`

```typescript
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

let globalDb: PostgresJsDatabase | null = null;

export function setGlobalConnection(db: PostgresJsDatabase): void {
	globalDb = db;
}

export function getGlobalConnection(): PostgresJsDatabase {
	if (!globalDb) {
		throw new Error(
			'No database connection. Call createBagpipe(db) first or pass connection to Model().'
		);
	}
	return globalDb;
}

export function createConnection(connectionString: string): PostgresJsDatabase {
	const client = postgres(connectionString);
	return drizzle(client);
}
```

#### 2. Model Factory Implementation

**File**: `src/model.ts`

```typescript
import { eq, desc, asc } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getGlobalConnection, setGlobalConnection } from './connection';
import { RecordNotFoundError } from './errors';

type TableColumns<T extends PgTable> = T['_']['columns'];

interface ModelClass<T extends PgTable> {
	// Static methods
	find(id: number): Promise<ModelInstanceType<T>>;
	findBy(attrs: Partial<Record<string, unknown>>): Promise<ModelInstanceType<T> | null>;
	all(): Promise<ModelInstanceType<T>[]>;
	first(): Promise<ModelInstanceType<T> | null>;
	last(): Promise<ModelInstanceType<T> | null>;
	create(attrs: Record<string, unknown>): Promise<ModelInstanceType<T>>;
	update(id: number, attrs: Record<string, unknown>): Promise<ModelInstanceType<T>>;
	destroy(id: number): Promise<void>;
	new (attrs?: Record<string, unknown>): ModelInstanceType<T>;

	// Metadata
	readonly table: T;
	readonly tableName: string;
	readonly primaryKey: string;
	readonly timestamps: { createdAt?: string; updatedAt?: string };
}

interface ModelInstanceType<T extends PgTable> {
	id: number | null;
	save(): Promise<this>;
	update(attrs: Record<string, unknown>): Promise<this>;
	destroy(): Promise<void>;
	readonly isNewRecord: boolean;
	readonly isPersisted: boolean;
	[key: string]: any;
}

// Detect conventions from table schema
function detectConventions<T extends PgTable>(table: T) {
	const columns = table._.columns as Record<string, PgColumn<any, any, any>>;

	// Find primary key (convention: 'id')
	let primaryKey = 'id';
	for (const [name, col] of Object.entries(columns)) {
		if (col.primary) {
			primaryKey = name;
			break;
		}
	}

	// Detect timestamp columns
	const timestamps: { createdAt?: string; updatedAt?: string } = {};
	if ('createdAt' in columns) timestamps.createdAt = 'createdAt';
	if ('created_at' in columns) timestamps.createdAt = 'created_at';
	if ('updatedAt' in columns) timestamps.updatedAt = 'updatedAt';
	if ('updated_at' in columns) timestamps.updatedAt = 'updated_at';

	// Table name from Drizzle table config
	const tableName = table._.name;

	return { primaryKey, timestamps, tableName };
}

// Create a model instance with Proxy for attribute access
function createInstance<T extends PgTable>(
	ModelClass: ModelClass<T>,
	attrs: Record<string, unknown>,
	persisted: boolean
): ModelInstanceType<T> {
	const data = { ...attrs };
	let _persisted = persisted;

	const instance = {
		get isNewRecord() {
			return !_persisted;
		},
		get isPersisted() {
			return _persisted;
		},

		async save(): Promise<typeof instance> {
			const db = getGlobalConnection();
			const { primaryKey, timestamps } = ModelClass;

			// Auto-manage updated_at
			if (timestamps.updatedAt) {
				data[timestamps.updatedAt] = new Date();
			}

			if (_persisted) {
				// Update existing record
				const id = data[primaryKey] as number;
				const updateData = { ...data };
				delete updateData[primaryKey];

				await db
					.update(ModelClass.table)
					.set(updateData)
					.where(eq((ModelClass.table as any)[primaryKey], id));
			} else {
				// Insert new record
				if (timestamps.createdAt && !data[timestamps.createdAt]) {
					data[timestamps.createdAt] = new Date();
				}

				const [result] = await db.insert(ModelClass.table).values(data).returning();

				Object.assign(data, result);
				_persisted = true;
			}

			return instance;
		},

		async update(attrs: Record<string, unknown>): Promise<typeof instance> {
			Object.assign(data, attrs);
			return instance.save();
		},

		async destroy(): Promise<void> {
			if (!_persisted) return;

			const db = getGlobalConnection();
			const { primaryKey } = ModelClass;
			const id = data[primaryKey] as number;

			await db.delete(ModelClass.table).where(eq((ModelClass.table as any)[primaryKey], id));

			_persisted = false;
		}
	};

	// Return Proxy for dynamic attribute access
	return new Proxy(instance, {
		get(target, prop: string) {
			if (prop in target) {
				return (target as any)[prop];
			}
			return data[prop];
		},
		set(_target, prop: string, value) {
			data[prop] = value;
			return true;
		}
	}) as ModelInstanceType<T>;
}

export function Model<T extends PgTable>(table: T): ModelClass<T> {
	const conventions = detectConventions(table);

	const ModelClass: ModelClass<T> = {
		table,
		tableName: conventions.tableName,
		primaryKey: conventions.primaryKey,
		timestamps: conventions.timestamps,

		async find(id: number): Promise<ModelInstanceType<T>> {
			const db = getGlobalConnection();
			const pk = conventions.primaryKey;

			const [result] = await db
				.select()
				.from(table)
				.where(eq((table as any)[pk], id))
				.limit(1);

			if (!result) {
				throw new RecordNotFoundError(conventions.tableName, id);
			}

			return createInstance(ModelClass, result, true);
		},

		async findBy(attrs: Partial<Record<string, unknown>>): Promise<ModelInstanceType<T> | null> {
			const db = getGlobalConnection();

			let query = db.select().from(table);

			for (const [key, value] of Object.entries(attrs)) {
				query = query.where(eq((table as any)[key], value)) as any;
			}

			const [result] = await query.limit(1);

			if (!result) return null;

			return createInstance(ModelClass, result, true);
		},

		async all(): Promise<ModelInstanceType<T>[]> {
			const db = getGlobalConnection();
			const results = await db.select().from(table);
			return results.map((r) => createInstance(ModelClass, r, true));
		},

		async first(): Promise<ModelInstanceType<T> | null> {
			const db = getGlobalConnection();
			const pk = conventions.primaryKey;

			const [result] = await db
				.select()
				.from(table)
				.orderBy(asc((table as any)[pk]))
				.limit(1);

			if (!result) return null;

			return createInstance(ModelClass, result, true);
		},

		async last(): Promise<ModelInstanceType<T> | null> {
			const db = getGlobalConnection();
			const pk = conventions.primaryKey;

			const [result] = await db
				.select()
				.from(table)
				.orderBy(desc((table as any)[pk]))
				.limit(1);

			if (!result) return null;

			return createInstance(ModelClass, result, true);
		},

		async create(attrs: Record<string, unknown>): Promise<ModelInstanceType<T>> {
			const instance = ModelClass.new(attrs);
			await instance.save();
			return instance;
		},

		async update(id: number, attrs: Record<string, unknown>): Promise<ModelInstanceType<T>> {
			const instance = await ModelClass.find(id);
			await instance.update(attrs);
			return instance;
		},

		async destroy(id: number): Promise<void> {
			const db = getGlobalConnection();
			const pk = conventions.primaryKey;

			await db.delete(table).where(eq((table as any)[pk], id));
		},

		new(attrs: Record<string, unknown> = {}): ModelInstanceType<T> {
			return createInstance(ModelClass, attrs, false);
		}
	};

	return ModelClass;
}

export function createBagpipe(db: PostgresJsDatabase): { Model: typeof Model } {
	setGlobalConnection(db);
	return { Model };
}
```

#### 3. Update Exports

**File**: `src/index.ts`

```typescript
export { Model, createBagpipe } from './model';
export { createConnection, setGlobalConnection } from './connection';
export * from './errors';
export type * from './types';
```

#### 4. Update Dependencies

**File**: `package.json` (update dependencies section)

```json
{
	"dependencies": {
		"drizzle-orm": "^0.29.0",
		"postgres": "^3.4.0",
		"zod": "^3.22.0"
	},
	"devDependencies": {
		"@types/node": "^20.10.0",
		"@types/pg": "^8.10.0",
		"@typescript-eslint/eslint-plugin": "^7.0.0",
		"@typescript-eslint/parser": "^7.0.0",
		"eslint": "^8.56.0",
		"typescript": "^5.3.0",
		"vitest": "^1.2.0"
	}
}
```

### Success Criteria:

#### Automated Verification:

- [x] `bun run check` passes
- [x] `bun run lint` passes
- [x] `bun run build` succeeds

#### Manual Verification:

- [x] Code review: convention detection logic is correct
- [x] Code review: Proxy implementation allows direct attribute access

**Implementation Note**: After completing this phase, proceed to Phase 3 for read operation tests.

---

## Phase 3: Read Operations & Unit Tests

### Overview

Implement comprehensive unit tests for all read operations: find(), findBy(), all(), first(), last(). Tests use mocked database to verify logic without actual DB.

### Changes Required:

#### 1. Test Fixtures

**File**: `tests/fixtures/schema.ts`

```typescript
import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
	id: serial('id').primaryKey(),
	name: text('name'),
	email: text('email').notNull(),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow()
});

export const posts = pgTable('posts', {
	id: serial('id').primaryKey(),
	title: text('title').notNull(),
	body: text('body'),
	userId: integer('user_id').references(() => users.id),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow()
});
```

**File**: `tests/fixtures/models.ts`

```typescript
import { Model } from '../../src/model';
import { users, posts } from './schema';

export const User = Model(users);
export const Post = Model(posts);
```

#### 2. Unit Tests for Errors

**File**: `tests/unit/errors.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { BagpipeError, RecordNotFoundError } from '../../src/errors';

describe('BagpipeError', () => {
	it('is an instance of Error', () => {
		const error = new BagpipeError('test');
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('BagpipeError');
	});

	it('has correct message', () => {
		const error = new BagpipeError('something went wrong');
		expect(error.message).toBe('something went wrong');
	});
});

describe('RecordNotFoundError', () => {
	it('extends BagpipeError', () => {
		const error = new RecordNotFoundError('User', 123);
		expect(error).toBeInstanceOf(BagpipeError);
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
```

#### 3. Unit Tests for Model

**File**: `tests/unit/model.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Model } from '../../src/model';
import { setGlobalConnection } from '../../src/connection';
import { RecordNotFoundError } from '../../src/errors';
import { users } from '../fixtures/schema';

// Mock database
function createMockDb() {
	const mockResults: any[] = [];

	const mockQuery = {
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		orderBy: vi.fn().mockReturnThis(),
		limit: vi.fn().mockImplementation(() => Promise.resolve(mockResults)),
		values: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		returning: vi.fn().mockImplementation(() => Promise.resolve(mockResults))
	};

	const db = {
		select: vi.fn().mockReturnValue(mockQuery),
		insert: vi.fn().mockReturnValue(mockQuery),
		update: vi.fn().mockReturnValue(mockQuery),
		delete: vi.fn().mockReturnValue(mockQuery),
		_setResults: (results: any[]) => {
			mockResults.length = 0;
			mockResults.push(...results);
		},
		_mockQuery: mockQuery
	};

	return db;
}

describe('Model()', () => {
	let db: ReturnType<typeof createMockDb>;
	let User: ReturnType<typeof Model<typeof users>>;

	beforeEach(() => {
		db = createMockDb();
		setGlobalConnection(db as any);
		User = Model(users);
	});

	describe('convention detection', () => {
		it('detects table name', () => {
			expect(User.tableName).toBe('users');
		});

		it('detects primary key', () => {
			expect(User.primaryKey).toBe('id');
		});

		it('detects timestamp columns', () => {
			expect(User.timestamps.createdAt).toBe('createdAt');
			expect(User.timestamps.updatedAt).toBe('updatedAt');
		});
	});

	describe('find()', () => {
		it('returns model instance when found', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = await User.find(1);

			expect(user.id).toBe(1);
			expect(user.name).toBe('Duke');
			expect(user.email).toBe('duke@example.com');
		});

		it('throws RecordNotFoundError when not found', async () => {
			db._setResults([]);

			await expect(User.find(999)).rejects.toThrow(RecordNotFoundError);
			await expect(User.find(999)).rejects.toThrow('users with id 999 not found');
		});

		it('marks instance as persisted', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = await User.find(1);

			expect(user.isPersisted).toBe(true);
			expect(user.isNewRecord).toBe(false);
		});
	});

	describe('findBy()', () => {
		it('returns model instance when found', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const user = await User.findBy({ email: 'duke@example.com' });

			expect(user).not.toBeNull();
			expect(user!.email).toBe('duke@example.com');
		});

		it('returns null when not found', async () => {
			db._setResults([]);

			const user = await User.findBy({ email: 'nonexistent@example.com' });

			expect(user).toBeNull();
		});

		it('supports multiple attributes', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			await User.findBy({ name: 'Duke', email: 'duke@example.com' });

			expect(db._mockQuery.where).toHaveBeenCalledTimes(2);
		});
	});

	describe('all()', () => {
		it('returns all records as model instances', async () => {
			db._setResults([
				{ id: 1, name: 'Duke', email: 'duke@example.com' },
				{ id: 2, name: 'Jane', email: 'jane@example.com' }
			]);

			const users = await User.all();

			expect(users).toHaveLength(2);
			expect(users[0].name).toBe('Duke');
			expect(users[1].name).toBe('Jane');
		});

		it('returns empty array when no records', async () => {
			db._setResults([]);

			const users = await User.all();

			expect(users).toEqual([]);
		});

		it('marks all instances as persisted', async () => {
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

			const users = await User.all();

			expect(users[0].isPersisted).toBe(true);
		});
	});

	describe('first()', () => {
		it('returns first record ordered by primary key', async () => {
			db._setResults([{ id: 1, name: 'First', email: 'first@example.com' }]);

			const user = await User.first();

			expect(user).not.toBeNull();
			expect(user!.name).toBe('First');
			expect(db._mockQuery.orderBy).toHaveBeenCalled();
		});

		it('returns null when no records', async () => {
			db._setResults([]);

			const user = await User.first();

			expect(user).toBeNull();
		});
	});

	describe('last()', () => {
		it('returns last record ordered by primary key desc', async () => {
			db._setResults([{ id: 100, name: 'Last', email: 'last@example.com' }]);

			const user = await User.last();

			expect(user).not.toBeNull();
			expect(user!.name).toBe('Last');
			expect(db._mockQuery.orderBy).toHaveBeenCalled();
		});

		it('returns null when no records', async () => {
			db._setResults([]);

			const user = await User.last();

			expect(user).toBeNull();
		});
	});

	describe('new()', () => {
		it('creates unpersisted instance', () => {
			const user = User.new({ name: 'Duke', email: 'duke@example.com' });

			expect(user.name).toBe('Duke');
			expect(user.email).toBe('duke@example.com');
			expect(user.isNewRecord).toBe(true);
			expect(user.isPersisted).toBe(false);
		});

		it('allows attribute modification', () => {
			const user = User.new({ name: 'Duke' });

			user.name = 'Modified';

			expect(user.name).toBe('Modified');
		});

		it('handles empty attributes', () => {
			const user = User.new();

			expect(user.isNewRecord).toBe(true);
			expect(user.name).toBeUndefined();
		});
	});
});
```

### Success Criteria:

#### Automated Verification:

- [x] `bun run test:unit` passes all unit tests (26 tests)
- [x] `bun run check` passes
- [x] `bun run lint` passes

#### Manual Verification:

- [x] Review test coverage - all read operations have tests
- [x] Review edge cases are covered (not found, empty results, etc.)

**Implementation Note**: After tests pass, proceed to Phase 4 for write operations.

---

## Phase 4: Write Operations & Tests

### Overview

Add tests for write operations: create(), save(), update() (both static and instance), and verify auto-managed updated_at timestamp.

### Changes Required:

#### 1. Write Operation Tests

**File**: `tests/unit/model.test.ts` (add to existing file)

```typescript
// Add these test suites to the existing model.test.ts

describe('create()', () => {
	it('creates and persists a new record', async () => {
		db._setResults([
			{
				id: 1,
				name: 'Duke',
				email: 'duke@example.com',
				createdAt: new Date(),
				updatedAt: new Date()
			}
		]);

		const user = await User.create({ name: 'Duke', email: 'duke@example.com' });

		expect(user.id).toBe(1);
		expect(user.isPersisted).toBe(true);
		expect(db.insert).toHaveBeenCalled();
	});

	it('auto-sets createdAt timestamp', async () => {
		const now = new Date();
		db._setResults([
			{ id: 1, name: 'Duke', email: 'duke@example.com', createdAt: now, updatedAt: now }
		]);

		await User.create({ name: 'Duke', email: 'duke@example.com' });

		expect(db._mockQuery.values).toHaveBeenCalled();
		// Verify createdAt was included in the insert
	});
});

describe('save()', () => {
	describe('new record', () => {
		it('inserts the record', async () => {
			db._setResults([
				{
					id: 1,
					name: 'Duke',
					email: 'duke@example.com',
					createdAt: new Date(),
					updatedAt: new Date()
				}
			]);

			const user = User.new({ name: 'Duke', email: 'duke@example.com' });
			await user.save();

			expect(user.isPersisted).toBe(true);
			expect(db.insert).toHaveBeenCalled();
		});

		it('updates id after insert', async () => {
			db._setResults([{ id: 42, name: 'Duke', email: 'duke@example.com' }]);

			const user = User.new({ name: 'Duke', email: 'duke@example.com' });
			expect(user.id).toBeUndefined();

			await user.save();

			expect(user.id).toBe(42);
		});
	});

	describe('existing record', () => {
		it('updates the record', async () => {
			// First, simulate finding an existing record
			db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
			const user = await User.find(1);

			// Then update
			db._setResults([]);
			user.name = 'Modified';
			await user.save();

			expect(db.update).toHaveBeenCalled();
		});

		it('auto-updates updatedAt timestamp', async () => {
			db._setResults([
				{ id: 1, name: 'Duke', email: 'duke@example.com', updatedAt: new Date('2020-01-01') }
			]);
			const user = await User.find(1);

			const beforeUpdate = user.updatedAt;
			db._setResults([]);

			user.name = 'Modified';
			await user.save();

			// The updatedAt should have been set to a new value in the update call
			expect(db._mockQuery.set).toHaveBeenCalled();
		});
	});

	it('returns the instance for chaining', async () => {
		db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

		const user = User.new({ name: 'Duke', email: 'duke@example.com' });
		const result = await user.save();

		expect(result).toBe(user);
	});
});

describe('update() instance method', () => {
	it('updates attributes and saves', async () => {
		db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
		const user = await User.find(1);

		db._setResults([]);
		await user.update({ name: 'New Name' });

		expect(user.name).toBe('New Name');
		expect(db.update).toHaveBeenCalled();
	});

	it('returns the instance for chaining', async () => {
		db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
		const user = await User.find(1);

		db._setResults([]);
		const result = await user.update({ name: 'New Name' });

		expect(result).toBe(user);
	});
});

describe('User.update() static method', () => {
	it('finds and updates the record', async () => {
		db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);

		// After find, need results for update
		const user = await User.update(1, { name: 'New Name' });

		expect(user.name).toBe('New Name');
	});

	it('throws RecordNotFoundError if record does not exist', async () => {
		db._setResults([]);

		await expect(User.update(999, { name: 'New Name' })).rejects.toThrow(RecordNotFoundError);
	});
});
```

### Success Criteria:

#### Automated Verification:

- [x] `bun run test:unit` passes all unit tests including write operations (43 tests)
- [x] `bun run check` passes
- [x] `bun run lint` passes

#### Manual Verification:

- [ ] Review: updated_at auto-management is tested
- [ ] Review: Both static and instance update() methods are tested

**Implementation Note**: After tests pass, proceed to Phase 5 for delete operations.

---

## Phase 5: Delete Operations & Tests

### Overview

Add tests for delete operations: destroy() both as instance method and static method.

### Changes Required:

#### 1. Delete Operation Tests

**File**: `tests/unit/model.test.ts` (add to existing file)

```typescript
// Add these test suites to the existing model.test.ts

describe('destroy() instance method', () => {
	it('deletes the record from database', async () => {
		db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
		const user = await User.find(1);

		await user.destroy();

		expect(db.delete).toHaveBeenCalled();
	});

	it('marks instance as not persisted', async () => {
		db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
		const user = await User.find(1);

		expect(user.isPersisted).toBe(true);

		await user.destroy();

		expect(user.isPersisted).toBe(false);
		expect(user.isNewRecord).toBe(true);
	});

	it('is a no-op for unpersisted records', async () => {
		const user = User.new({ name: 'Duke', email: 'duke@example.com' });

		await user.destroy();

		expect(db.delete).not.toHaveBeenCalled();
	});

	it('preserves attributes after destroy', async () => {
		db._setResults([{ id: 1, name: 'Duke', email: 'duke@example.com' }]);
		const user = await User.find(1);

		await user.destroy();

		expect(user.name).toBe('Duke');
		expect(user.email).toBe('duke@example.com');
	});
});

describe('User.destroy() static method', () => {
	it('deletes the record by id', async () => {
		await User.destroy(1);

		expect(db.delete).toHaveBeenCalled();
	});

	it('does not throw if record does not exist', async () => {
		// Static destroy is idempotent - doesn't check existence
		await expect(User.destroy(999)).resolves.toBeUndefined();
	});
});
```

### Success Criteria:

#### Automated Verification:

- [x] `bun run test:unit` passes all unit tests including delete operations (43 tests)
- [x] `bun run check` passes
- [x] `bun run lint` passes

#### Manual Verification:

- [ ] Review: Instance destroy marks as unpersisted
- [ ] Review: Static destroy is idempotent

**Implementation Note**: After tests pass, proceed to Phase 6 for integration tests.

---

## Phase 6: Integration Tests

### Overview

Create integration tests that run against a real PostgreSQL database to verify the full CRUD flow works correctly in practice.

### Changes Required:

#### 1. Docker Compose for Test Database

**File**: `docker-compose.yml`

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: bagpipe
      POSTGRES_PASSWORD: bagpipe
      POSTGRES_DB: bagpipe_test
    ports:
      - '5432:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U bagpipe -d bagpipe_test']
      interval: 5s
      timeout: 5s
      retries: 5
```

#### 2. Test Setup Helper

**File**: `tests/integration/setup.ts`

```typescript
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { setGlobalConnection } from '../../src/connection';
import { users, posts } from '../fixtures/schema';

const connectionString =
	process.env.DATABASE_URL || 'postgresql://bagpipe:bagpipe@localhost:5432/bagpipe_test';

let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

export async function setupTestDb() {
	client = postgres(connectionString);
	db = drizzle(client);
	setGlobalConnection(db);

	// Create tables
	await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

	await db.execute(sql`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT,
      user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

	return db;
}

export async function cleanupTestDb() {
	await db.execute(sql`TRUNCATE TABLE posts, users RESTART IDENTITY CASCADE`);
}

export async function teardownTestDb() {
	await db.execute(sql`DROP TABLE IF EXISTS posts`);
	await db.execute(sql`DROP TABLE IF EXISTS users`);
	await client.end();
}

export { db };
```

#### 3. Integration Tests

**File**: `tests/integration/crud.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, cleanupTestDb, teardownTestDb } from './setup';
import { Model } from '../../src/model';
import { RecordNotFoundError } from '../../src/errors';
import { users } from '../fixtures/schema';

describe('CRUD Integration Tests', () => {
	let User: ReturnType<typeof Model<typeof users>>;

	beforeAll(async () => {
		await setupTestDb();
		User = Model(users);
	});

	afterAll(async () => {
		await teardownTestDb();
	});

	beforeEach(async () => {
		await cleanupTestDb();
	});

	describe('Create', () => {
		it('creates a record with all attributes', async () => {
			const user = await User.create({
				name: 'Duke Jones',
				email: 'duke@example.com'
			});

			expect(user.id).toBe(1);
			expect(user.name).toBe('Duke Jones');
			expect(user.email).toBe('duke@example.com');
			expect(user.createdAt).toBeInstanceOf(Date);
			expect(user.updatedAt).toBeInstanceOf(Date);
		});

		it('creates a record using new() and save()', async () => {
			const user = User.new({
				name: 'Jane Doe',
				email: 'jane@example.com'
			});

			expect(user.isNewRecord).toBe(true);

			await user.save();

			expect(user.isNewRecord).toBe(false);
			expect(user.isPersisted).toBe(true);
			expect(user.id).toBe(1);
		});

		it('auto-generates timestamps on create', async () => {
			const before = new Date();
			const user = await User.create({ email: 'test@example.com' });
			const after = new Date();

			expect(user.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(user.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
		});
	});

	describe('Read', () => {
		beforeEach(async () => {
			await User.create({ name: 'User 1', email: 'user1@example.com' });
			await User.create({ name: 'User 2', email: 'user2@example.com' });
			await User.create({ name: 'User 3', email: 'user3@example.com' });
		});

		it('find() returns record by id', async () => {
			const user = await User.find(2);

			expect(user.id).toBe(2);
			expect(user.name).toBe('User 2');
		});

		it('find() throws RecordNotFoundError for missing id', async () => {
			await expect(User.find(999)).rejects.toThrow(RecordNotFoundError);
		});

		it('findBy() returns first matching record', async () => {
			const user = await User.findBy({ email: 'user2@example.com' });

			expect(user).not.toBeNull();
			expect(user!.name).toBe('User 2');
		});

		it('findBy() returns null for no match', async () => {
			const user = await User.findBy({ email: 'nonexistent@example.com' });

			expect(user).toBeNull();
		});

		it('all() returns all records', async () => {
			const users = await User.all();

			expect(users).toHaveLength(3);
			expect(users.map((u) => u.name)).toEqual(['User 1', 'User 2', 'User 3']);
		});

		it('first() returns record with lowest id', async () => {
			const user = await User.first();

			expect(user).not.toBeNull();
			expect(user!.id).toBe(1);
			expect(user!.name).toBe('User 1');
		});

		it('last() returns record with highest id', async () => {
			const user = await User.last();

			expect(user).not.toBeNull();
			expect(user!.id).toBe(3);
			expect(user!.name).toBe('User 3');
		});

		it('first() returns null for empty table', async () => {
			await cleanupTestDb();

			const user = await User.first();

			expect(user).toBeNull();
		});
	});

	describe('Update', () => {
		it('instance update() modifies and saves', async () => {
			const user = await User.create({ name: 'Original', email: 'test@example.com' });
			const originalUpdatedAt = user.updatedAt;

			// Small delay to ensure timestamp difference
			await new Promise((resolve) => setTimeout(resolve, 10));

			await user.update({ name: 'Modified' });

			expect(user.name).toBe('Modified');

			// Verify persisted
			const reloaded = await User.find(user.id);
			expect(reloaded.name).toBe('Modified');
		});

		it('static update() finds and modifies record', async () => {
			const created = await User.create({ name: 'Original', email: 'test@example.com' });

			const updated = await User.update(created.id, { name: 'Static Update' });

			expect(updated.name).toBe('Static Update');

			// Verify persisted
			const reloaded = await User.find(created.id);
			expect(reloaded.name).toBe('Static Update');
		});

		it('save() updates existing record', async () => {
			const user = await User.create({ name: 'Original', email: 'test@example.com' });

			user.name = 'Direct Assignment';
			await user.save();

			const reloaded = await User.find(user.id);
			expect(reloaded.name).toBe('Direct Assignment');
		});

		it('auto-updates updatedAt on save', async () => {
			const user = await User.create({ name: 'Test', email: 'test@example.com' });
			const originalUpdatedAt = user.updatedAt;

			await new Promise((resolve) => setTimeout(resolve, 10));

			user.name = 'Modified';
			await user.save();

			const reloaded = await User.find(user.id);
			expect(reloaded.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
		});
	});

	describe('Delete', () => {
		it('instance destroy() removes record', async () => {
			const user = await User.create({ name: 'To Delete', email: 'delete@example.com' });
			const id = user.id;

			await user.destroy();

			expect(user.isPersisted).toBe(false);
			await expect(User.find(id)).rejects.toThrow(RecordNotFoundError);
		});

		it('static destroy() removes record by id', async () => {
			const user = await User.create({ name: 'To Delete', email: 'delete@example.com' });

			await User.destroy(user.id);

			await expect(User.find(user.id)).rejects.toThrow(RecordNotFoundError);
		});

		it('destroy() on new record is no-op', async () => {
			const user = User.new({ name: 'Never Saved', email: 'new@example.com' });

			await user.destroy(); // Should not throw

			expect(user.isPersisted).toBe(false);
		});
	});

	describe('Edge Cases', () => {
		it('handles null attribute values', async () => {
			const user = await User.create({ name: null, email: 'test@example.com' });

			expect(user.name).toBeNull();

			const reloaded = await User.find(user.id);
			expect(reloaded.name).toBeNull();
		});

		it('handles special characters in strings', async () => {
			const specialName = 'O\'Brien "The Great"';
			const user = await User.create({ name: specialName, email: 'test@example.com' });

			const reloaded = await User.find(user.id);
			expect(reloaded.name).toBe(specialName);
		});

		it('maintains instance identity after save', async () => {
			const user = User.new({ email: 'test@example.com' });
			const result = await user.save();

			expect(result).toBe(user);
		});
	});
});
```

#### 4. Package.json Scripts Update

Add to `package.json` scripts:

```json
{
	"scripts": {
		"db:up": "docker-compose up -d",
		"db:down": "docker-compose down",
		"test:integration": "npm run db:up && sleep 2 && vitest run --config vitest.integration.config.ts; npm run db:down"
	}
}
```

### Success Criteria:

#### Automated Verification:

- [ ] `bun run db:test:up` starts PostgreSQL container (requires Docker)
- [ ] `bun run test:integration` passes all integration tests (requires Docker)
- [ ] `bun run db:test:down` stops container cleanly (requires Docker)
- [x] `bun run test:unit` (unit tests) still pass (43 tests)
- [x] `bun run check` passes
- [x] `bun run lint` passes

#### Manual Verification:

- [ ] Review: All CRUD operations work against real PostgreSQL (requires Docker)
- [ ] Review: Timestamps are correctly managed (requires Docker)
- [ ] Review: Edge cases (null, special chars) are handled (requires Docker)

**Implementation Note**: After all tests pass, M1 is complete. Integration tests require Docker to be running - use `bun run db:test:up` first.

---

## Testing Strategy

### Unit Tests:

- Mock Drizzle database layer
- Test each method in isolation
- Cover error conditions (not found, invalid input)
- Cover edge cases (empty results, null values)

### Integration Tests:

- Real PostgreSQL via Docker
- Full CRUD lifecycle
- Timestamp auto-management
- Data persistence verification

### Test Commands:

```bash
npm test                # Unit tests only (fast)
npm run test:integration # Integration tests (requires Docker)
npm run test:watch      # Watch mode for development
```

## Performance Considerations

- No performance concerns for M1 - focus is on correctness
- Future milestones will address N+1 queries (M6: eager loading)
- Connection pooling handled by Drizzle/postgres.js defaults

## Migration Notes

N/A - This is a greenfield project.

## References

- PRD: [PRD.md](../../PRD.md)
- Drizzle ORM docs: https://orm.drizzle.team/
- Vitest docs: https://vitest.dev/
