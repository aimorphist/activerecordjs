# ActiveRecordJS Learnings

Technical discoveries and patterns learned during implementation.

---

## Class Mixin Pattern for TypeScript ORMs

**Date**: 2026-01-24
**Phase**: AR3 Phase 1

The key architectural insight for enabling `class User extends Model(usersTable)` syntax:

```typescript
export function Model<T extends PgTable>(table: T) {
  return class BaseModel {
    // Static properties accessible via this.constructor
    static table = table;
    static validations: Record<string, unknown> = {};

    // Instance uses Proxy for dynamic attribute access
    constructor(attrs: Record<string, unknown> = {}, persisted = false) {
      return new Proxy(this, { /* ... */ });
    }
  };
}
```

**Why it works**:
- Factory returns a class, not an object
- Subclasses can override static properties (validations, hooks)
- Parent methods access subclass statics via `this.constructor`
- Backward compatible: `const User = Model(table)` still works

**Index signature requirement**: Added `[key: string]: any` to allow TypeScript to accept dynamic property access via Proxy.

---

## Immutable QueryBuilder Pattern

**Date**: 2026-01-24
**Phase**: AR2

Each chain method returns a new QueryBuilder instance:

```typescript
where(conditions): QueryBuilder<T, Instance> {
  return this.clone({ whereConditions: [...this.state.whereConditions, ...newConditions] });
}
```

**Benefits**:
- Prevents shared state bugs between queries
- Enables query composition: `const activeUsers = User.where({ active: true }); const admins = activeUsers.where({ role: 'admin' });`
- Thread-safe (though not relevant for JS)

---

## Drizzle Convention Detection

**Date**: 2026-01-24
**Phase**: AR1

Drizzle tables expose metadata at `table._.columns` and `table._.name`:

```typescript
function detectConventions<T extends PgTable>(table: T) {
  const columns = table._.columns as Record<string, PgColumn>;
  const tableName = table._.name;

  // Find primary key
  let primaryKey = 'id';
  for (const [name, col] of Object.entries(columns)) {
    if (col.primary) { primaryKey = name; break; }
  }

  // Detect timestamps
  const timestamps: { createdAt?: string; updatedAt?: string } = {};
  if ('createdAt' in columns) timestamps.createdAt = 'createdAt';
  // etc.
}
```

---

## PostgreSQL Sequences with SERIAL

**Date**: 2026-01-24
**Phase**: AR2 Integration Tests

`DROP TABLE CASCADE` properly handles sequences created by SERIAL columns. No need to manually drop sequences.

---

## Vitest Parallel Test Isolation

**Date**: 2026-01-24
**Phase**: AR2

For integration tests sharing a database:
- `fileParallelism: false` prevents test files from running concurrently
- Transaction-based isolation (start tx in beforeEach, rollback in afterEach) enables parallelism
- Current implementation uses TRUNCATE between tests (sequential)

**Future improvement**: Implement transaction-per-test pattern for speed.

---

## Zod Integration for Validations

**Date**: 2026-01-24
**Phase**: AR3

Zod's `safeParse()` enables clean validation without try/catch:

```typescript
const result = validator.safeParse(value);
if (!result.success) {
  this._errors[field] = result.error.errors.map((e) => e.message);
}
```

Custom validators throw `ValidationError` which gets merged into the errors object.
