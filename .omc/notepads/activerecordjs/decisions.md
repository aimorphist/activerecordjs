# ActiveRecordJS Decisions

Architectural and design decisions made during implementation.

---

## PostgreSQL Only (For Now)

**Date**: 2026-01-24
**Phase**: AR1
**Decision**: Target PostgreSQL exclusively
**Rationale**:
- Simplifies implementation
- Matches Drizzle's strongest driver (postgres.js)
- Can abstract later if needed

---

## Drizzle as Foundation, Not Abstraction

**Date**: 2026-01-24
**Phase**: AR1
**Decision**: Build on top of Drizzle, don't replace it
**Rationale**:
- Drizzle handles migrations, schema, connection pooling
- ActiveRecordJS provides ergonomic API layer
- `User.query()` escape hatch for complex Drizzle queries
- Users can still use raw Drizzle when needed

---

## Class Mixin Over Plain Factory

**Date**: 2026-01-24
**Phase**: AR3
**Decision**: `Model(table)` returns a class, not an object
**Rationale**:
- Enables `class User extends Model(table)` syntax
- Subclass static properties (validations, hooks) accessible from parent
- Foundation for AR4-AR9 features
- Backward compatible

---

## Zod for Validations

**Date**: 2026-01-24
**Phase**: AR3
**Decision**: Use Zod schemas for field validation
**Rationale**:
- Already a dependency
- Type-safe validation
- Composable validators
- Good error messages
- `$custom` array for complex cross-field validation

---

## Immutable QueryBuilder

**Date**: 2026-01-24
**Phase**: AR2
**Decision**: Each chain method returns new instance
**Rationale**:
- Prevents subtle shared-state bugs
- Enables query composition
- Small performance cost (object creation) acceptable

---

## Auto-Validate on save(), Opt-Out Available

**Date**: 2026-01-24
**Phase**: AR3
**Decision**: `save()` runs validation by default, `{ validate: false }` skips
**Rationale**:
- Safe by default (invalid data doesn't reach DB)
- Escape hatch for bulk operations, migrations
- Matches Rails behavior

---

## Proxy for Dynamic Attribute Access

**Date**: 2026-01-24
**Phase**: AR1
**Decision**: Use JavaScript Proxy for `user.name` / `user.name = 'x'`
**Rationale**:
- Clean Rails-like API
- No `.get()` / `.set()` methods
- Direct attribute assignment
- TypeScript `[key: string]: any` index signature required

---

## Timestamps as Convention, Not Requirement

**Date**: 2026-01-24
**Phase**: AR1
**Decision**: Auto-detect `createdAt`/`created_at` and `updatedAt`/`updated_at`
**Rationale**:
- Works with both camelCase and snake_case
- No configuration needed
- Models without timestamps work fine

---

## Primary Key Convention: 'id'

**Date**: 2026-01-24
**Phase**: AR1
**Decision**: Default to 'id' as primary key, detect from schema
**Rationale**:
- Matches Rails convention
- Auto-detects from Drizzle's `primaryKey()` column
- Supports custom PKs via schema definition
