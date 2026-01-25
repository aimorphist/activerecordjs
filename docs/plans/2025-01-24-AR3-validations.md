# AR3: Validations Implementation Plan

## Overview

Implement Zod-based validation system for Bagpipe ORM, including refactoring the Model factory to support class syntax for better developer ergonomics and future milestone compatibility (hooks, associations, scopes).

## Current State Analysis

**What exists:**
- Model factory returns a plain object with static methods ([model.ts:178-376](src/lib/activerecordjs/model.ts#L178-L376))
- Instance creation via Proxy pattern ([model.ts:87-176](src/lib/activerecordjs/model.ts#L87-L176))
- Zod already a dependency (`"zod": "^3.22.0"`)
- Basic error hierarchy: `ActiveRecordJSError` → `RecordNotFoundError`

**What's missing:**
- Class-based model syntax (`class User extends Model(users)`)
- Validation declarations on models
- ValidationError with field details
- `isValid()`, `validate()`, `errors` API
- Validation integration with `save()`

## Desired End State

```typescript
import { Model, ValidationError } from 'bagpipe';
import { z } from 'zod';

class User extends Model(users) {
  static validations = {
    email: z.string().email(),
    name: z.string().min(1).max(100).optional(),

    $custom: [
      (user) => {
        if (user.email?.endsWith('@banned.com')) {
          throw new ValidationError('email', 'banned domain');
        }
      }
    ]
  };
}

// Usage
const user = User.build({ email: 'invalid' });
user.isValid();        // false
user.errors;           // { email: ['Invalid email'] }
user.validate();       // throws ValidationError

await user.save();                    // throws ValidationError (auto-validates)
await user.save({ validate: false }); // skips validation
```

### Verification:
- All existing tests pass (backward compatibility)
- New validation unit tests pass
- New validation integration tests pass
- `npm run test:unit` and `npm run test:integration` succeed

## What We're NOT Doing

- Hooks (AR4) - separate milestone
- Associations (AR5-6) - separate milestone
- Async validators - keep it simple for now
- Schema-level validations (unique constraints) - DB handles these
- i18n for error messages - out of scope

---

## Implementation Approach

The key architectural change is converting `Model(table)` from returning an object to returning a class. This enables:
1. `class User extends Model(users)` syntax
2. Subclass static properties (`User.validations`) accessible from parent methods
3. Natural extensibility for custom methods
4. Foundation for AR4-AR9 features

**Backward compatibility:** `const User = Model(users)` will still work - it just assigns the class to a const.

---

## Phase 1: Refactor Model to Class Mixin Pattern

### Overview
Convert the Model factory from returning a plain object to returning a class, while maintaining all existing functionality and test compatibility.

### Changes Required:

#### 1. Update Model Factory
**File**: `src/lib/activerecordjs/model.ts`

Replace the current factory pattern with a class mixin:

```typescript
import { eq, desc, asc, getTableName, getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getGlobalConnection } from './connection';
import { RecordNotFoundError } from './errors';
import { QueryBuilder } from './query-builder';

// Detect conventions from table schema (unchanged)
function detectConventions<T extends PgTable>(table: T) {
  // ... existing implementation unchanged
}

export function Model<T extends PgTable>(table: T) {
  const conventions = detectConventions(table);

  return class BaseModel {
    // Instance state
    private _data: Record<string, unknown>;
    private _persisted: boolean;
    private _errors: Record<string, string[]> = {};

    // Static metadata (accessible via this.constructor in instance methods)
    static table = table;
    static tableName = conventions.tableName;
    static primaryKey = conventions.primaryKey;
    static timestamps = conventions.timestamps;

    // Placeholder for subclass validations (AR3)
    static validations: Record<string, unknown> = {};

    constructor(attrs: Record<string, unknown> = {}, persisted = false) {
      this._data = { ...attrs };
      this._persisted = persisted;

      // Return Proxy for dynamic attribute access
      return new Proxy(this, {
        get(target, prop: string) {
          // Instance properties and methods first
          if (prop in target || prop.startsWith('_')) {
            return (target as any)[prop];
          }
          // Then check data
          return target._data[prop];
        },
        set(target, prop: string, value) {
          if (prop.startsWith('_')) {
            (target as any)[prop] = value;
          } else {
            target._data[prop] = value;
          }
          return true;
        }
      });
    }

    // Instance getters
    get isNewRecord(): boolean {
      return !this._persisted;
    }

    get isPersisted(): boolean {
      return this._persisted;
    }

    get errors(): Record<string, string[]> {
      return this._errors;
    }

    // Instance methods
    async save(): Promise<this> {
      const ModelClass = this.constructor as typeof BaseModel;
      const db = getGlobalConnection();
      const { primaryKey, timestamps } = ModelClass;

      // Auto-manage updated_at
      if (timestamps.updatedAt) {
        this._data[timestamps.updatedAt] = new Date();
      }

      if (this._persisted) {
        // Update existing record
        const id = this._data[primaryKey] as number;
        const updateData = { ...this._data };
        delete updateData[primaryKey];

        await (db as any)
          .update(ModelClass.table)
          .set(updateData)
          .where(eq((ModelClass.table as any)[primaryKey], id));
      } else {
        // Insert new record
        if (timestamps.createdAt && !this._data[timestamps.createdAt]) {
          this._data[timestamps.createdAt] = new Date();
        }

        const [result] = await (db as any)
          .insert(ModelClass.table)
          .values(this._data)
          .returning();

        Object.assign(this._data, result);
        this._persisted = true;
      }

      return this;
    }

    async update(attrs: Record<string, unknown>): Promise<this> {
      Object.assign(this._data, attrs);
      return this.save();
    }

    async destroy(): Promise<void> {
      if (!this._persisted) return;

      const ModelClass = this.constructor as typeof BaseModel;
      const db = getGlobalConnection();
      const { primaryKey } = ModelClass;
      const id = this._data[primaryKey] as number;

      await (db as any)
        .delete(ModelClass.table)
        .where(eq((ModelClass.table as any)[primaryKey], id));

      this._persisted = false;
    }

    // Static methods
    static async find(id: number): Promise<InstanceType<typeof this>> {
      const db = getGlobalConnection();
      const pk = this.primaryKey;

      const [result] = await (db as any)
        .select()
        .from(this.table)
        .where(eq((this.table as any)[pk], id))
        .limit(1);

      if (!result) {
        throw new RecordNotFoundError(this.tableName, id);
      }

      return new this(result, true) as InstanceType<typeof this>;
    }

    static async findBy(
      attrs: Partial<Record<string, unknown>>
    ): Promise<InstanceType<typeof this> | null> {
      const db = getGlobalConnection();

      let query: any = (db as any).select().from(this.table);

      for (const [key, value] of Object.entries(attrs)) {
        query = query.where(eq((this.table as any)[key], value));
      }

      const [result] = await query.limit(1);

      if (!result) return null;

      return new this(result, true) as InstanceType<typeof this>;
    }

    static async all(): Promise<InstanceType<typeof this>[]> {
      const db = getGlobalConnection();
      const results = await (db as any).select().from(this.table);
      return results.map((r: any) => new this(r, true) as InstanceType<typeof this>);
    }

    static async first(): Promise<InstanceType<typeof this> | null> {
      const db = getGlobalConnection();
      const pk = this.primaryKey;

      const [result] = await (db as any)
        .select()
        .from(this.table)
        .orderBy(asc((this.table as any)[pk]))
        .limit(1);

      if (!result) return null;

      return new this(result, true) as InstanceType<typeof this>;
    }

    static async last(): Promise<InstanceType<typeof this> | null> {
      const db = getGlobalConnection();
      const pk = this.primaryKey;

      const [result] = await (db as any)
        .select()
        .from(this.table)
        .orderBy(desc((this.table as any)[pk]))
        .limit(1);

      if (!result) return null;

      return new this(result, true) as InstanceType<typeof this>;
    }

    static async create(
      attrs: Record<string, unknown>
    ): Promise<InstanceType<typeof this>> {
      const instance = new this(attrs, false);
      await instance.save();
      return instance as InstanceType<typeof this>;
    }

    static async update(
      id: number,
      attrs: Record<string, unknown>
    ): Promise<InstanceType<typeof this>> {
      const instance = await this.find(id);
      await instance.update(attrs);
      return instance;
    }

    static async destroy(id: number): Promise<void> {
      const db = getGlobalConnection();
      const pk = this.primaryKey;

      await (db as any)
        .delete(this.table)
        .where(eq((this.table as any)[pk], id));
    }

    // Aliases for 'new' (reserved word)
    static build(attrs?: Record<string, unknown>): InstanceType<typeof this> {
      return new this(attrs, false) as InstanceType<typeof this>;
    }

    static ['new'](attrs?: Record<string, unknown>): InstanceType<typeof this> {
      return new this(attrs, false) as InstanceType<typeof this>;
    }

    // Query builder entry points
    static where(
      conditionsOrSql: Record<string, unknown> | string,
      ...params: unknown[]
    ): QueryBuilder<T, InstanceType<typeof this>> {
      const ModelClass = this;
      const builder = new QueryBuilder<T, InstanceType<typeof this>>(
        this.table,
        (data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
        this
      );
      if (typeof conditionsOrSql === 'string') {
        return builder.where(conditionsOrSql, ...params);
      }
      return builder.where(conditionsOrSql);
    }

    static order(
      column: string,
      direction: 'asc' | 'desc' = 'asc'
    ): QueryBuilder<T, InstanceType<typeof this>> {
      const ModelClass = this;
      const builder = new QueryBuilder<T, InstanceType<typeof this>>(
        this.table,
        (data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
        this
      );
      return builder.order(column, direction);
    }

    static limit(n: number): QueryBuilder<T, InstanceType<typeof this>> {
      const ModelClass = this;
      const builder = new QueryBuilder<T, InstanceType<typeof this>>(
        this.table,
        (data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
        this
      );
      return builder.limit(n);
    }

    static offset(n: number): QueryBuilder<T, InstanceType<typeof this>> {
      const ModelClass = this;
      const builder = new QueryBuilder<T, InstanceType<typeof this>>(
        this.table,
        (data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
        this
      );
      return builder.offset(n);
    }

    static async count(): Promise<number> {
      const ModelClass = this;
      const builder = new QueryBuilder<T, InstanceType<typeof this>>(
        this.table,
        (data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
        this
      );
      return builder.count();
    }

    static async exists(conditions?: Record<string, unknown>): Promise<boolean> {
      const ModelClass = this;
      let builder = new QueryBuilder<T, InstanceType<typeof this>>(
        this.table,
        (data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
        this
      );
      if (conditions) {
        builder = builder.where(conditions);
      }
      return builder.exists();
    }

    static async findOrCreate(
      findAttrs: Record<string, unknown>,
      createAttrs: Record<string, unknown> = {}
    ): Promise<InstanceType<typeof this>> {
      const existing = await this.findBy(findAttrs);
      if (existing) return existing;
      return this.create({ ...findAttrs, ...createAttrs });
    }

    static async firstOrCreate(
      findAttrs: Record<string, unknown>,
      createAttrs: Record<string, unknown> = {}
    ): Promise<InstanceType<typeof this>> {
      return this.findOrCreate(findAttrs, createAttrs);
    }

    static async query<R>(
      fn: (table: T, db: any) => Promise<R>
    ): Promise<R> {
      const db = getGlobalConnection();
      return fn(this.table, db);
    }
  };
}

export function createActiveRecordJS(db: any): { Model: typeof Model } {
  const { setGlobalConnection } = require('./connection');
  setGlobalConnection(db);
  return { Model };
}
```

#### 2. Update Test Fixtures
**File**: `src/lib/activerecordjs/fixtures/models.ts`

Both syntaxes should work:

```typescript
import { Model } from '../model';
import { users, posts } from './schema';

// Factory syntax (backward compatible)
export const User = Model(users);
export const Post = Model(posts);

// Class syntax also works:
// export class User extends Model(users) {}
```

### Success Criteria:

#### Automated Verification:
- [x] All existing unit tests pass: `npm run test:unit -- --run src/lib/activerecordjs/model.test.ts`
- [x] All existing integration tests pass: `npm run test:integration`
- [x] TypeScript compiles without errors: `npm run check`
- [x] Linting passes: `npm run lint` (pre-existing issues in other files, model.ts is clean)

#### Manual Verification:
- [ ] `const User = Model(users)` still works (backward compatibility)
- [ ] `class User extends Model(users) {}` works (new syntax)
- [ ] Instance attribute access works (`user.name`, `user.email`)
- [ ] Instance attribute assignment works (`user.name = 'New'`)

**Implementation Note**: This phase is foundational. All existing tests must pass before proceeding.

---

## Phase 2: Add ValidationError

### Overview
Create the ValidationError class that collects field-level errors.

### Changes Required:

#### 1. Add ValidationError Class
**File**: `src/lib/activerecordjs/errors.ts`

```typescript
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
```

#### 2. Update Exports
**File**: `src/lib/activerecordjs/index.ts`

```typescript
export { Model, createActiveRecordJS } from './model';
export { QueryBuilder } from './query-builder';
export { createConnection, setGlobalConnection } from './connection';
export * from './errors';
export type * from './types';
```

#### 3. Add Error Tests
**File**: `src/lib/activerecordjs/errors.test.ts`

Add tests for ValidationError:

```typescript
import { describe, it, expect } from 'vitest';
import { ActiveRecordJSError, RecordNotFoundError, ValidationError } from './errors';

// ... existing tests ...

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
```

### Success Criteria:

#### Automated Verification:
- [x] Error tests pass: `npm run test:unit -- --run src/lib/activerecordjs/errors.test.ts`
- [x] TypeScript compiles: `npm run check` (pre-existing errors in other test files)

#### Manual Verification:
- [ ] ValidationError can be imported from 'bagpipe' index

---

## Phase 3: Implement Validation System

### Overview
Add `isValid()`, `validate()`, and `errors` to model instances, with support for Zod schemas and custom validators.

### Changes Required:

#### 1. Add Validation Logic to Model
**File**: `src/lib/activerecordjs/model.ts`

Add imports at top:

```typescript
import { z, ZodError, ZodSchema } from 'zod';
import { ValidationError } from './errors';
```

Add validation type definition:

```typescript
type CustomValidator<T> = (instance: T) => void | Promise<void>;

interface Validations {
  [field: string]: ZodSchema | CustomValidator<any>[];
  $custom?: CustomValidator<any>[];
}
```

Add to BaseModel class:

```typescript
// Inside the BaseModel class returned by Model()

// Static validations (overridden by subclass)
static validations: Validations = {};

// Instance methods for validation
isValid(): boolean {
  try {
    this.validate();
    return true;
  } catch {
    return false;
  }
}

validate(): void {
  const ModelClass = this.constructor as typeof BaseModel;
  const validations = ModelClass.validations;
  this._errors = {};

  // Run Zod validators for each field
  for (const [field, validator] of Object.entries(validations)) {
    if (field === '$custom') continue;

    if (validator instanceof z.ZodType) {
      const value = this._data[field];
      const result = validator.safeParse(value);

      if (!result.success) {
        this._errors[field] = result.error.errors.map((e) => e.message);
      }
    }
  }

  // Run custom validators
  const customValidators = validations.$custom ?? [];
  for (const validator of customValidators) {
    try {
      validator(this);
    } catch (e) {
      if (e instanceof ValidationError) {
        // Merge errors from custom validator
        for (const [field, messages] of Object.entries(e.errors)) {
          this._errors[field] = [...(this._errors[field] ?? []), ...messages];
        }
      } else {
        throw e;
      }
    }
  }

  // Throw if any errors
  if (Object.keys(this._errors).length > 0) {
    throw new ValidationError(this._errors);
  }
}

clearErrors(): void {
  this._errors = {};
}
```

#### 2. Add Validation Unit Tests
**File**: `src/lib/activerecordjs/validations.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { Model } from './model';
import { ValidationError } from './errors';
import { setGlobalConnection } from './connection';
import { users } from './fixtures/schema';

// Mock database (validations don't need real DB)
function createMockDb() {
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    delete: () => ({ where: () => Promise.resolve() })
  };
}

describe('Validations', () => {
  beforeEach(() => {
    setGlobalConnection(createMockDb() as any);
  });

  describe('Zod field validators', () => {
    it('validates email format', () => {
      class User extends Model(users) {
        static validations = {
          email: z.string().email()
        };
      }

      const user = User.build({ email: 'invalid' });

      expect(user.isValid()).toBe(false);
      expect(user.errors.email).toBeDefined();
      expect(user.errors.email[0]).toContain('email');
    });

    it('passes valid email', () => {
      class User extends Model(users) {
        static validations = {
          email: z.string().email()
        };
      }

      const user = User.build({ email: 'valid@example.com' });

      expect(user.isValid()).toBe(true);
      expect(user.errors).toEqual({});
    });

    it('validates multiple fields', () => {
      class User extends Model(users) {
        static validations = {
          email: z.string().email(),
          name: z.string().min(1)
        };
      }

      const user = User.build({ email: 'invalid', name: '' });

      expect(user.isValid()).toBe(false);
      expect(user.errors.email).toBeDefined();
      expect(user.errors.name).toBeDefined();
    });

    it('handles optional fields', () => {
      class User extends Model(users) {
        static validations = {
          name: z.string().min(1).optional()
        };
      }

      const user = User.build({ email: 'test@example.com' });

      expect(user.isValid()).toBe(true);
    });

    it('handles nullable fields', () => {
      class User extends Model(users) {
        static validations = {
          name: z.string().min(1).nullable()
        };
      }

      const user = User.build({ name: null });

      expect(user.isValid()).toBe(true);
    });
  });

  describe('Custom validators ($custom)', () => {
    it('runs custom validator', () => {
      class User extends Model(users) {
        static validations = {
          $custom: [
            (user: any) => {
              if (user.email?.endsWith('@banned.com')) {
                throw ValidationError.forField('email', 'domain is banned');
              }
            }
          ]
        };
      }

      const user = User.build({ email: 'test@banned.com' });

      expect(user.isValid()).toBe(false);
      expect(user.errors.email).toContain('domain is banned');
    });

    it('runs multiple custom validators', () => {
      class User extends Model(users) {
        static validations = {
          $custom: [
            (user: any) => {
              if (!user.name) {
                throw ValidationError.forField('name', 'is required');
              }
            },
            (user: any) => {
              if (user.name && user.name.length > 100) {
                throw ValidationError.forField('name', 'is too long');
              }
            }
          ]
        };
      }

      const user = User.build({ email: 'test@example.com' });

      expect(user.isValid()).toBe(false);
      expect(user.errors.name).toContain('is required');
    });

    it('combines Zod and custom validators', () => {
      class User extends Model(users) {
        static validations = {
          email: z.string().email(),
          $custom: [
            (user: any) => {
              if (user.email?.endsWith('@banned.com')) {
                throw ValidationError.forField('email', 'domain is banned');
              }
            }
          ]
        };
      }

      // Invalid format
      let user = User.build({ email: 'invalid' });
      expect(user.isValid()).toBe(false);
      expect(user.errors.email).toBeDefined();

      // Banned domain (format is valid)
      user = User.build({ email: 'test@banned.com' });
      expect(user.isValid()).toBe(false);
      expect(user.errors.email).toContain('domain is banned');
    });
  });

  describe('validate() method', () => {
    it('throws ValidationError on invalid', () => {
      class User extends Model(users) {
        static validations = {
          email: z.string().email()
        };
      }

      const user = User.build({ email: 'invalid' });

      expect(() => user.validate()).toThrow(ValidationError);
    });

    it('returns void on valid', () => {
      class User extends Model(users) {
        static validations = {
          email: z.string().email()
        };
      }

      const user = User.build({ email: 'valid@example.com' });

      expect(() => user.validate()).not.toThrow();
    });

    it('populates errors property', () => {
      class User extends Model(users) {
        static validations = {
          email: z.string().email()
        };
      }

      const user = User.build({ email: 'invalid' });

      try {
        user.validate();
      } catch {
        // expected
      }

      expect(user.errors.email).toBeDefined();
    });
  });

  describe('isValid() method', () => {
    it('returns false for invalid record', () => {
      class User extends Model(users) {
        static validations = {
          email: z.string().email()
        };
      }

      const user = User.build({ email: 'invalid' });

      expect(user.isValid()).toBe(false);
    });

    it('returns true for valid record', () => {
      class User extends Model(users) {
        static validations = {
          email: z.string().email()
        };
      }

      const user = User.build({ email: 'valid@example.com' });

      expect(user.isValid()).toBe(true);
    });

    it('clears previous errors before re-validating', () => {
      class User extends Model(users) {
        static validations = {
          email: z.string().email()
        };
      }

      const user = User.build({ email: 'invalid' });
      user.isValid(); // false, populates errors

      user.email = 'valid@example.com';
      user.isValid(); // true, should clear errors

      expect(user.errors).toEqual({});
    });
  });

  describe('Model without validations', () => {
    it('isValid returns true when no validations defined', () => {
      const User = Model(users);
      const user = User.build({ email: 'anything' });

      expect(user.isValid()).toBe(true);
    });

    it('validate does not throw when no validations defined', () => {
      const User = Model(users);
      const user = User.build({ email: 'anything' });

      expect(() => user.validate()).not.toThrow();
    });
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Validation tests pass: `npm run test:unit -- --run src/lib/activerecordjs/validations.test.ts`
- [x] All existing tests still pass: `npm run test:unit -- --run`
- [x] TypeScript compiles: `npm run check` (pre-existing errors in other test files)

#### Manual Verification:
- [ ] Class-based model with validations works as shown in examples
- [ ] `user.errors` is accessible and correctly typed

---

## Phase 4: Integrate Validation into save()

### Overview
Auto-run validations before save, with option to skip.

### Changes Required:

#### 1. Update save() Method
**File**: `src/lib/activerecordjs/model.ts`

Modify the save method signature and implementation:

```typescript
interface SaveOptions {
  validate?: boolean;
}

async save(options: SaveOptions = {}): Promise<this> {
  const { validate = true } = options;
  const ModelClass = this.constructor as typeof BaseModel;
  const db = getGlobalConnection();
  const { primaryKey, timestamps } = ModelClass;

  // Run validations unless explicitly skipped
  if (validate) {
    this.validate();
  }

  // ... rest of existing save logic unchanged
}
```

#### 2. Update create() to Pass Options
**File**: `src/lib/activerecordjs/model.ts`

```typescript
static async create(
  attrs: Record<string, unknown>,
  options: SaveOptions = {}
): Promise<InstanceType<typeof this>> {
  const instance = new this(attrs, false);
  await instance.save(options);
  return instance as InstanceType<typeof this>;
}
```

#### 3. Add Integration Tests for Validation + Save
**File**: `src/lib/activerecordjs/validations.integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  setupTestDb,
  teardownTestDb,
  beginTestTransaction,
  rollbackTestTransaction
} from './setup.integration';
import { Model } from './model';
import { ValidationError } from './errors';
import { users } from './fixtures/schema';

describe('Validations Integration Tests', () => {
  class User extends Model(users) {
    static validations = {
      email: z.string().email(),
      name: z.string().min(1).optional(),
      $custom: [
        (user: any) => {
          if (user.email?.endsWith('@banned.com')) {
            throw ValidationError.forField('email', 'domain is banned');
          }
        }
      ]
    };
  }

  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await beginTestTransaction();
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  describe('save() with validation', () => {
    it('rejects invalid record on save', async () => {
      const user = User.build({ email: 'invalid' });

      await expect(user.save()).rejects.toThrow(ValidationError);
      expect(user.isPersisted).toBe(false);
    });

    it('saves valid record', async () => {
      const user = User.build({ email: 'valid@example.com' });

      await user.save();

      expect(user.isPersisted).toBe(true);
      expect(user.id).toBeGreaterThan(0);
    });

    it('allows skipping validation with { validate: false }', async () => {
      const user = User.build({ email: 'invalid' });

      await user.save({ validate: false });

      expect(user.isPersisted).toBe(true);
    });

    it('validates on update', async () => {
      const user = await User.create({ email: 'valid@example.com' });

      user.email = 'invalid';

      await expect(user.save()).rejects.toThrow(ValidationError);
    });

    it('runs custom validators on save', async () => {
      const user = User.build({ email: 'test@banned.com' });

      await expect(user.save()).rejects.toThrow(ValidationError);
      expect(user.errors.email).toContain('domain is banned');
    });
  });

  describe('create() with validation', () => {
    it('rejects invalid attributes', async () => {
      await expect(User.create({ email: 'invalid' })).rejects.toThrow(ValidationError);
    });

    it('creates valid record', async () => {
      const user = await User.create({ email: 'valid@example.com' });

      expect(user.isPersisted).toBe(true);
    });

    it('allows skipping validation with { validate: false }', async () => {
      const user = await User.create({ email: 'invalid' }, { validate: false });

      expect(user.isPersisted).toBe(true);
    });
  });

  describe('update() with validation', () => {
    it('validates on instance update', async () => {
      const user = await User.create({ email: 'valid@example.com' });

      await expect(user.update({ email: 'invalid' })).rejects.toThrow(ValidationError);
    });

    it('updates with valid attributes', async () => {
      const user = await User.create({ email: 'valid@example.com' });

      await user.update({ name: 'Duke' });

      expect(user.name).toBe('Duke');
    });
  });

  describe('errors persistence', () => {
    it('errors are accessible after failed save', async () => {
      const user = User.build({ email: 'invalid' });

      try {
        await user.save();
      } catch {
        // expected
      }

      expect(user.errors.email).toBeDefined();
      expect(user.errors.email.length).toBeGreaterThan(0);
    });

    it('errors are cleared on successful save', async () => {
      const user = User.build({ email: 'invalid' });

      try {
        await user.save();
      } catch {
        // expected
      }

      expect(Object.keys(user.errors).length).toBeGreaterThan(0);

      user.email = 'valid@example.com';
      await user.save();

      expect(user.errors).toEqual({});
    });
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Integration tests pass: `npm run test:integration` (activerecordjs tests pass, unrelated failures in other modules)
- [x] All unit tests still pass: `npm run test:unit -- --run`
- [x] TypeScript compiles: `npm run check` (pre-existing errors in other test files)
- [x] Linting passes: `npm run lint` (pre-existing issues in other files)

#### Manual Verification:
- [ ] Invalid records cannot be saved (throws ValidationError)
- [ ] `{ validate: false }` option bypasses validation
- [ ] Error messages are descriptive and helpful

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that validation behavior meets expectations before considering AR3 complete.

---

## Phase 5: Update Types and Documentation

### Overview
Update TypeScript types and add inline documentation.

### Changes Required:

#### 1. Update Type Definitions
**File**: `src/lib/activerecordjs/types.ts`

```typescript
import type { PgTable } from 'drizzle-orm/pg-core';
import type { ZodSchema } from 'zod';

export type AnyPgTable = PgTable<any>;

export type CustomValidator<T> = (instance: T) => void | Promise<void>;

export interface Validations<T = any> {
  [field: string]: ZodSchema | CustomValidator<T>[];
  $custom?: CustomValidator<T>[];
}

export interface SaveOptions {
  validate?: boolean;
}

export interface ModelStatic<T> {
  find(id: number): Promise<T>;
  findBy(attrs: Partial<Record<string, unknown>>): Promise<T | null>;
  all(): Promise<T[]>;
  first(): Promise<T | null>;
  last(): Promise<T | null>;
  create(attrs: Record<string, unknown>, options?: SaveOptions): Promise<T>;
  update(id: number, attrs: Record<string, unknown>): Promise<T>;
  destroy(id: number): Promise<void>;
  build(attrs?: Record<string, unknown>): T;
  new (attrs?: Record<string, unknown>): T;

  // Metadata
  readonly table: AnyPgTable;
  readonly tableName: string;
  readonly primaryKey: string;
  readonly timestamps: { createdAt?: string; updatedAt?: string };
  readonly validations: Validations<T>;
}

export interface ModelInstance {
  id: number | null;
  save(options?: SaveOptions): Promise<this>;
  update(attrs: Record<string, unknown>): Promise<this>;
  destroy(): Promise<void>;
  validate(): void;
  isValid(): boolean;
  clearErrors(): void;
  readonly isNewRecord: boolean;
  readonly isPersisted: boolean;
  readonly errors: Record<string, string[]>;
}
```

#### 2. Update Index Exports
**File**: `src/lib/activerecordjs/index.ts`

```typescript
export { Model, createActiveRecordJS } from './model';
export { QueryBuilder } from './query-builder';
export { createConnection, setGlobalConnection } from './connection';
export * from './errors';
export type * from './types';

// Re-export Zod for convenience
export { z } from 'zod';
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run check` (pre-existing errors in other test files)
- [x] All tests pass: `npm run test:unit -- --run && npm run test:integration`

#### Manual Verification:
- [ ] IDE autocomplete works for validation methods
- [ ] Types are accurate and helpful

---

## Testing Strategy

### Unit Tests:
- ValidationError construction and methods
- Zod field validation (email, string length, optional, nullable)
- Custom validators ($custom array)
- `isValid()`, `validate()`, `errors` behavior
- Model without validations (backward compatibility)

### Integration Tests:
- save() rejects invalid records
- save() with `{ validate: false }` bypasses validation
- create() validates before insert
- update() validates before update
- Errors persist after failed save, clear after success

### Edge Cases:
- Empty validations object
- Null/undefined field values
- Multiple errors on same field
- Custom validator throwing non-ValidationError
- Async considerations (validation is sync for now)

---

## Migration Notes

**Backward Compatibility:**
- `const User = Model(users)` continues to work unchanged
- Models without `validations` static property work as before
- Existing tests should pass without modification

**Breaking Changes:**
- None expected

---

## References

- PRD: [docs/PRD.md](docs/PRD.md) - AR3 requirements
- Current Model: [src/lib/activerecordjs/model.ts](src/lib/activerecordjs/model.ts)
- Zod Documentation: https://zod.dev/
- Rails Validations: https://guides.rubyonrails.org/active_record_validations.html
