# ActiveRecordJS Implementation Plan

## Overview

ActiveRecordJS brings Rails-style ActiveRecord ergonomics to TypeScript, built on Drizzle ORM. This plan consolidates all milestones (AR1-AR9) and tracks implementation progress.

## Current State

| Milestone | Description | Status | Tests |
|-----------|-------------|--------|-------|
| **AR1** | Foundation (Model, CRUD) | ✅ Complete | 43 unit, 21 integration |
| **AR2** | Query Builder (where, order, limit) | ✅ Complete | 24 unit, 24 integration |
| **AR3** | Validations (Zod-based) | 🔄 Phase 1/5 | 38 validation tests |
| **AR4** | Lifecycle Hooks | ⏳ Not started | - |
| **AR5** | Associations (belongsTo, hasOne) | ⏳ Not started | - |
| **AR6** | Associations (hasMany, HABTM) | ⏳ Not started | - |
| **AR7** | Transactions | ⏳ Not started | - |
| **AR8** | Scopes | ⏳ Not started | - |
| **AR9** | Advanced Features | ⏳ Not started | - |

**Total tests passing**: 150 across 7 files

## API Surface (Current)

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

// Validations (AR3)
const user = User.build({ email: 'invalid' });
user.isValid();        // false
user.errors;           // { email: ['Invalid email'] }
user.validate();       // throws ValidationError
await user.save();     // auto-validates, throws on invalid
await user.save({ validate: false }); // skip validation
```

---

## AR3: Validations (IN PROGRESS)

### Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | Refactor Model to Class Mixin | ✅ Complete |
| **Phase 2** | Add ValidationError | ✅ Tests exist |
| **Phase 3** | Implement Validation System | ✅ Tests exist |
| **Phase 4** | Integrate Validation into save() | ✅ Tests exist |
| **Phase 5** | Update Types and Documentation | ⏳ Pending |

### What's Done

1. **Model refactored to class mixin pattern**
   - `class User extends Model(usersTable)` syntax works
   - Backward compatible with `const User = Model(usersTable)`
   - Proxy pattern for dynamic attribute access preserved

2. **Validation tests written** (38 tests in `validations.test.ts` and `validations.integration.test.ts`)

### What's Remaining

- Phase 5: Update `types.ts` with validation interfaces
- Manual verification of validation behavior
- Documentation updates

### Success Criteria

- [ ] All 150+ tests pass
- [ ] TypeScript compiles: `bun run check`
- [ ] Manual: `user.isValid()` / `user.validate()` work as expected
- [ ] Manual: `save()` auto-validates, `{ validate: false }` skips

---

## AR4: Lifecycle Hooks (PLANNED)

### Overview

Add Rails-style lifecycle callbacks: `beforeSave`, `afterSave`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDestroy`, `afterDestroy`.

### API Design

```typescript
class User extends Model(usersTable) {
  static beforeSave = [
    async (user) => {
      user.email = user.email?.toLowerCase();
    }
  ];

  static afterCreate = [
    async (user) => {
      await sendWelcomeEmail(user.email);
    }
  ];
}
```

### Implementation Approach

1. Add hook type definitions
2. Hook registration on static properties
3. Hook execution in save/create/update/destroy
4. Order: before hooks → operation → after hooks
5. Support async hooks

---

## AR5-6: Associations (PLANNED)

### AR5: belongsTo, hasOne

```typescript
class Post extends Model(postsTable) {
  static belongsTo = {
    user: { model: () => User, foreignKey: 'userId' }
  };
}

const post = await Post.find(1);
const author = await post.user; // Lazy load
```

### AR6: hasMany, HABTM

```typescript
class User extends Model(usersTable) {
  static hasMany = {
    posts: { model: () => Post, foreignKey: 'userId' }
  };
}

const user = await User.find(1);
const posts = await user.posts; // Returns Post[]
```

### Key Decisions Needed

- Eager loading syntax (`includes`, `with`, etc.)
- N+1 prevention strategy
- Join table conventions for HABTM

---

## AR7: Transactions (PLANNED)

### API Design

```typescript
await User.transaction(async (tx) => {
  const user = await User.create({ email: 'test@example.com' }, { transaction: tx });
  await Post.create({ userId: user.id, title: 'First Post' }, { transaction: tx });
  // Auto-commits on success, rolls back on error
});
```

### Implementation Notes

- Leverage Drizzle's transaction support
- Pass transaction through operation chain
- Consider savepoints for nested transactions

---

## AR8: Scopes (PLANNED)

### API Design

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

### Implementation Approach

- Scopes return QueryBuilder
- Scopes are chainable
- Default scope support (optional)

---

## Technical References

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/activerecordjs/model.ts` | Core Model class (class mixin pattern) |
| `src/lib/activerecordjs/query-builder.ts` | Immutable QueryBuilder class |
| `src/lib/activerecordjs/errors.ts` | Error types (ValidationError, RecordNotFoundError) |
| `src/lib/activerecordjs/connection.ts` | Global DB connection management |
| `src/lib/activerecordjs/types.ts` | TypeScript interfaces |
| `src/lib/activerecordjs/fixtures/` | Test schema and models |

### Test Commands

```bash
bun test --filter "activerecord"     # All ActiveRecordJS tests
bun run test:integration             # Integration tests (requires local PG)
bun run check                        # TypeScript check
```

### Legacy Plan References

The original detailed plans are preserved for reference:
- `thoughts/shared/plans/2026-01-24-ar1-orm-foundation.md`
- `thoughts/shared/plans/2026-01-24-ar2-orm-query-builder.md`
- `docs/plans/2025-01-24-AR3-validations.md`
