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

## Phase 5: Dependent Option Implementation (2026-01-27)

### What Was Built
- Added `dependent: 'destroy' | 'nullify' | 'restrict'` option to hasMany and hasOne associations
- Implemented three-pass processing strategy in `processDependentAssociations()`:
  1. Restrict checks (fail fast)
  2. Destroy cascades (recursive)
  3. Nullify updates (batch SQL)
- Created `DependentRestrictError` for constraint violations
- Integrated into Model.destroy() lifecycle after beforeDestroy hooks

### Key Patterns
- **Fail Fast**: Restrict checks happen FIRST before any mutations
- **Recursive Destroy**: Each child's destroy() is called, triggering their own dependent processing
- **Batch Nullify**: Uses raw SQL UPDATE for efficiency
- **Transaction Safety**: All dependent operations happen in same transaction as owner delete

### Testing Approach
- Created separate test model classes with specific dependent configurations
- Cannot dynamically modify Model static properties at runtime
- Used inheritance from Model(table) to create variants with different associations
- Transaction rollback means failed FK violations can't be verified post-failure

### Gotchas
- Comment schema uses `body` field, not `content`
- FK constraint errors abort transactions, preventing subsequent queries
- Test error messages are wrapped and don't always expose underlying DB errors
- Default User model has no dependent options, causing FK violations on destroy

### Files Modified
- `/Users/dukejones/work/Morphist/bagpipe/src/lib/activerecordjs/errors.ts` - Added DependentRestrictError
- `/Users/dukejones/work/Morphist/bagpipe/src/lib/activerecordjs/associations.ts` - Added processDependentAssociations
- `/Users/dukejones/work/Morphist/bagpipe/src/lib/activerecordjs/model.ts` - Hooked into destroy()
- `/Users/dukejones/work/Morphist/bagpipe/src/lib/activerecordjs/dependent.integration.test.ts` - Complete test coverage

### Test Results
All 10 tests pass:
- dependent: destroy (hasMany, hasOne, recursive)
- dependent: nullify (hasMany, hasOne)
- dependent: restrict (with/without children, fail fast)
- no dependent option (FK violation)
- lifecycle hooks (still fire correctly)

