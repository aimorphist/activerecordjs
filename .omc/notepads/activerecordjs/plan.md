# ActiveRecordJS Implementation Plan

> **Last Updated**: 2026-01-26
> **Status**: AR3 in progress (Phase 5 blocked by TypeScript errors)
> **Next Milestone**: Fix TS errors → Complete AR3 → Begin AR4

---

## Executive Summary

ActiveRecordJS brings Rails-style ActiveRecord ergonomics to TypeScript, built on Drizzle ORM. Target: PostgreSQL. Philosophy: ergonomic API layer on top of Drizzle, not a replacement.

**Total Progress**: AR1-AR2 complete, AR3 ~95% complete (blocked), AR4-AR9 planned

---

## Milestone Overview

| Milestone | Description | Status | Depends On | Tests |
|-----------|-------------|--------|------------|-------|
| **AR1** | Foundation (Model, CRUD) | ✅ Complete | - | 43 unit, 21 integration |
| **AR2** | Query Builder | ✅ Complete | AR1 | 24 unit, 24 integration |
| **AR3** | Validations (Zod-based) | 🔴 Blocked | AR2 | 38 validation tests |
| **AR4** | Lifecycle Hooks | ⏳ Ready | AR3 | - |
| **AR5** | Associations (belongsTo, hasOne) | ⏳ Planned | AR4 | - |
| **AR6** | Associations (hasMany, HABTM) | ⏳ Planned | AR5 | - |
| **AR7** | Transactions | ⏳ Planned | AR3 | - |
| **AR8** | Scopes | ⏳ Planned | AR2 | - |
| **AR9** | Advanced Features | ⏳ Planned | AR6, AR7, AR8 | - |

---

## Current Blockers

| Blocker | Severity | File | Details |
|---------|----------|------|---------|
| TypeScript self-ref error | HIGH | model.ts:125,173,220,242 | `ModelClass` references itself |
| Fixture syntax error | MEDIUM | fixtures/models.ts:1 | `\import` instead of `import` |

See [issues.md](./issues.md) for full details and workarounds.

---

## Next Actions

1. **Fix TypeScript errors** in `model.ts` (self-referential type issue)
2. **Fix fixture bug** in `fixtures/models.ts` (remove backslash)
3. **Verify** all 150 tests still pass
4. **Verify** `bun run check` passes for activerecordjs files
5. **Mark AR3 complete** and update this plan
6. **Begin AR4** (Lifecycle Hooks)

---

## Milestone Details

### AR1: Foundation ✅ COMPLETE

**Scope**: Core Model class, CRUD operations, conventions

**Implementation**:
- Class mixin pattern: `class User extends Model(usersTable)`
- Proxy for dynamic attribute access: `user.name`, `user.name = 'x'`
- Auto-detect primary key, timestamps (createdAt/updatedAt)
- CRUD: `create()`, `find()`, `findBy()`, `update()`, `destroy()`

**Verification**:
```bash
bun test src/lib/activerecordjs/model.test.ts
bun test src/lib/activerecordjs/crud.integration.test.ts
```

**Success Criteria**: ✅ All met
- [x] `User.create({})` inserts and returns instance
- [x] `User.find(id)` retrieves by primary key
- [x] `user.update({})` modifies attributes
- [x] `user.destroy()` deletes record
- [x] Dynamic attributes via Proxy work
- [x] Timestamps auto-managed

---

### AR2: Query Builder ✅ COMPLETE

**Scope**: Chainable, immutable query builder

**Implementation**:
- Immutable: each method returns new QueryBuilder
- Chaining: `where()`, `order()`, `limit()`, `offset()`
- Terminals: `all()`, `first()`, `last()`, `count()`, `exists()`
- Utilities: `findOrCreate()`, `pluck()`

**Verification**:
```bash
bun test src/lib/activerecordjs/query-builder.test.ts
bun test src/lib/activerecordjs/query-builder.integration.test.ts
```

**Success Criteria**: ✅ All met
- [x] `User.where({}).order().limit().all()` works
- [x] QueryBuilder is immutable (no shared state)
- [x] `count()`, `exists()` work correctly
- [x] 24 unit + 24 integration tests pass

---

### AR3: Validations 🔴 BLOCKED (95% complete)

**Scope**: Zod-based field validation + custom validators

**Implementation** (DONE):
- Zod validators on `static validations` property
- Custom validators in `$custom` array
- Methods: `validate()`, `isValid()`, `clearErrors()`
- Auto-validate on `save()`, opt-out with `{ validate: false }`
- `ValidationError` class with field-level errors

**Phase Status**:
| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Refactor Model to class mixin | ✅ Complete |
| 2 | Add ValidationError class | ✅ Complete |
| 3 | Implement validation system | ✅ Complete |
| 4 | Integrate into save() | ✅ Complete |
| 5 | Fix types, verify, document | 🔴 Blocked |

**Current Blocker**: TypeScript errors in model.ts (see Blockers section)

**Verification**:
```bash
bun test src/lib/activerecordjs/validations.test.ts
bun test src/lib/activerecordjs/validations.integration.test.ts
bun run check 2>&1 | grep activerecordjs  # Should show 0 errors
```

**Success Criteria**:
- [x] `user.isValid()` returns boolean
- [x] `user.validate()` throws on invalid
- [x] `user.errors` contains field-level messages
- [x] `save()` auto-validates
- [x] `save({ validate: false })` skips validation
- [ ] TypeScript compiles without errors
- [ ] All 38 validation tests pass (currently: ✅)

---

### AR4: Lifecycle Hooks ⏳ READY (blocked by AR3)

**Scope**: Rails-style callbacks: before/after save, create, update, destroy

**API Design**:
```typescript
class User extends Model(usersTable) {
  static beforeSave = [
    async (user) => { user.email = user.email?.toLowerCase(); }
  ];

  static afterCreate = [
    async (user) => { await sendWelcomeEmail(user.email); }
  ];
}
```

**Implementation Plan**:
1. Define hook types: `BeforeHook<T>`, `AfterHook<T>`
2. Add static properties for each hook type
3. Execute hooks in order: before → operation → after
4. Support async hooks
5. Add tests for each hook point

**Verification**:
```bash
bun test src/lib/activerecordjs/hooks.test.ts  # To be created
bun test src/lib/activerecordjs/hooks.integration.test.ts  # To be created
```

**Success Criteria**:
- [ ] beforeSave fires before save()
- [ ] afterSave fires after successful save()
- [ ] beforeCreate/afterCreate for new records
- [ ] beforeUpdate/afterUpdate for existing records
- [ ] beforeDestroy/afterDestroy for destroy()
- [ ] Async hooks work correctly
- [ ] Hook can abort operation (return false?)

---

### AR5: Associations (belongsTo, hasOne) ⏳ PLANNED

**Scope**: Single-record associations

**API Design**:
```typescript
class Post extends Model(postsTable) {
  static belongsTo = {
    user: { model: () => User, foreignKey: 'userId' }
  };
}

const post = await Post.find(1);
const author = await post.user;  // Lazy load
```

**Key Decisions Needed**:
- Eager loading syntax: `includes()` vs `with()` vs `load()`
- How to type the association return (generic inference)
- Caching strategy for loaded associations

**Success Criteria**:
- [ ] `belongsTo` returns single related record
- [ ] `hasOne` returns single related record
- [ ] Lazy loading works
- [ ] Eager loading syntax decided and implemented
- [ ] Proper TypeScript typing

---

### AR6: Associations (hasMany, HABTM) ⏳ PLANNED

**Scope**: Collection associations

**API Design**:
```typescript
class User extends Model(usersTable) {
  static hasMany = {
    posts: { model: () => Post, foreignKey: 'userId' }
  };
}

const user = await User.find(1);
const posts = await user.posts;  // Returns Post[]
```

**Key Decisions Needed**:
- N+1 prevention strategy
- Join table conventions for HABTM
- Association collection methods (build, create, etc.)

**Success Criteria**:
- [ ] `hasMany` returns array of related records
- [ ] HABTM works with join table
- [ ] N+1 detection/prevention in place
- [ ] Collection methods work

---

### AR7: Transactions ⏳ PLANNED

**Scope**: Transaction support with auto-commit/rollback

**API Design**:
```typescript
await User.transaction(async (tx) => {
  const user = await User.create({ email: 'test@example.com' }, { transaction: tx });
  await Post.create({ userId: user.id, title: 'First Post' }, { transaction: tx });
  // Auto-commits on success, rolls back on error
});
```

**Implementation Notes**:
- Leverage Drizzle's transaction support
- Pass transaction context through operation chain
- Consider savepoints for nested transactions

**Success Criteria**:
- [ ] Transaction commits on success
- [ ] Transaction rolls back on error
- [ ] All CRUD operations accept transaction option
- [ ] Nested transactions with savepoints (optional)

---

### AR8: Scopes ⏳ PLANNED

**Scope**: Named query presets

**API Design**:
```typescript
class User extends Model(usersTable) {
  static scopes = {
    active: (q) => q.where({ active: true }),
    admins: (q) => q.where({ role: 'admin' }),
    recent: (q) => q.order('createdAt', 'desc').limit(10)
  };
}

await User.active.admins.all();
await User.recent.first();
```

**Success Criteria**:
- [ ] Scopes return QueryBuilder
- [ ] Scopes are chainable
- [ ] Default scope support (optional)

---

### AR9: Advanced Features ⏳ PLANNED

**Scope**: Polish and advanced capabilities

**Features**:
- Async validators (uniqueness checks)
- Dirty tracking (`user.changed?`, `user.changes`)
- Reload (`user.reload()`)
- Touch timestamps
- Counter caches
- Optimistic locking

**Success Criteria**:
- [ ] At least 3 advanced features implemented
- [ ] Full test coverage
- [ ] Documentation complete

---

## API Quick Reference

```typescript
import { Model, ValidationError, z } from 'bagpipe';

// Define model with validations
class User extends Model(usersTable) {
  static validations = {
    email: z.string().email(),
    name: z.string().min(1).optional(),
    $custom: [
      (user) => {
        if (user.email?.endsWith('@banned.com')) {
          throw ValidationError.forField('email', 'domain is banned');
        }
      }
    ]
  };
}

// CRUD Operations
const user = await User.create({ email: 'duke@example.com', name: 'Duke' });
const found = await User.find(1);
const byEmail = await User.findBy({ email: 'duke@example.com' });
await user.update({ name: 'New Name' });
await user.destroy();

// Query Builder (chainable, immutable)
await User.where({ active: true }).order('createdAt', 'desc').limit(10).all();
await User.where({ role: 'admin' }).count();
await User.exists({ email: 'test@example.com' });
await User.findOrCreate({ email: 'new@example.com' }, { name: 'New User' });

// Validations
const user = User.build({ email: 'invalid' });
user.isValid();        // false
user.errors;           // { email: ['Invalid email'] }
user.validate();       // throws ValidationError
await user.save();     // auto-validates, throws on invalid
await user.save({ validate: false }); // skip validation
```

---

## Technical References

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/lib/activerecordjs/model.ts` | Core Model class (mixin pattern) | 470 |
| `src/lib/activerecordjs/query-builder.ts` | Immutable QueryBuilder | 193 |
| `src/lib/activerecordjs/errors.ts` | ValidationError, RecordNotFoundError | 43 |
| `src/lib/activerecordjs/connection.ts` | Global DB connection | 76 |
| `src/lib/activerecordjs/types.ts` | TypeScript interfaces | 47 |
| `src/lib/activerecordjs/index.ts` | Public exports | 9 |

### Test Commands

```bash
# Run all ActiveRecordJS tests
bun test --filter "activerecord"

# Run specific test suites
bun test src/lib/activerecordjs/model.test.ts
bun test src/lib/activerecordjs/validations.test.ts

# Run integration tests (requires local Postgres)
bun run test:integration

# TypeScript check
bun run check

# Lint
bun run lint
```

### Test Counts

| File | Tests |
|------|-------|
| model.test.ts | 43 |
| query-builder.test.ts | 24 |
| query-builder.integration.test.ts | 24 |
| validations.test.ts | 38 |
| validations.integration.test.ts | varies |
| crud.integration.test.ts | 21 |
| **Total** | **150** |

---

## Dependency Graph

```
AR1 (Foundation)
 └── AR2 (Query Builder)
      └── AR3 (Validations) ← CURRENT
           ├── AR4 (Hooks)
           │    └── AR5 (belongsTo, hasOne)
           │         └── AR6 (hasMany, HABTM)
           │              └── AR9 (Advanced)
           ├── AR7 (Transactions)
           │    └── AR9 (Advanced)
           └── AR8 (Scopes)
                └── AR9 (Advanced)
```

---

## Legacy Plan References

Original detailed plans preserved for reference:
- `thoughts/shared/plans/2026-01-24-ar1-orm-foundation.md`
- `thoughts/shared/plans/2026-01-24-ar2-orm-query-builder.md`
- `docs/plans/2025-01-24-AR3-validations.md`
