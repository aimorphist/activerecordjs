# AR5: Associations (Core) - Implementation Plan

> **Created**: 2026-01-26
> **Status**: Ready for Implementation
> **Depends On**: AR4 (Lifecycle Hooks) - COMPLETE
> **Estimated Effort**: 2-3 days
> **Revision**: 2 (addressed Critic feedback)

---

## 1. Overview

AR5 implements the foundational association system for ActiveRecordJS, enabling Rails-style `belongsTo` and `hasMany` declarations with lazy loading, association proxies, and foreign key inference.

**Scope**:
- `belongsTo` declaration and lazy loading
- `hasMany` declaration and lazy loading
- Association proxies: `.create()`, `.build()`, `.count()`
- Foreign key convention inference
- Manual foreign key override

**NOT in scope** (deferred to AR6):
- `hasOne` (simpler variant of hasMany, can be AR6)
- `hasMany :through` (join table associations)
- `hasManyAndBelongsToMany` (HABTM)
- Eager loading / `includes()` (AR6 - requires QueryBuilder changes)
- N+1 detection (AR6)

---

## 2. Current State Analysis

### Existing Architecture

**Model class** (`src/lib/activerecordjs/model.ts`):
- Class mixin pattern: `class User extends Model(usersTable)`
- Proxy pattern intercepts property access for dynamic attributes
- Static properties pattern established: `static validations`, `static beforeSave[]`
- ~537 lines, well-structured

**Proxy handler** (lines 119-136):
```typescript
return new Proxy(this, {
  get(target, prop: string) {
    if (prop in target || prop.startsWith('_')) {
      return (target as any)[prop];
    }
    return target._data[prop];
  },
  set(target, prop: string, value) {
    // ...
  }
});
```

**Schema with foreign keys** (`src/lib/activerecordjs/fixtures/schema.ts`):
```typescript
export const postsTable = pgTable('posts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => usersTable.id),
  // ...
});
```

### What We Need to Add

1. **Association metadata storage**: Static `belongsTo` and `hasMany` declarations
2. **Association resolver**: Logic to load related records
3. **Proxy enhancement**: Intercept association property access for lazy loading
4. **Association cache**: Store loaded associations to avoid repeat queries
5. **Association proxies**: CollectionProxy for hasMany operations
6. **Foreign key inference**: Derive `userId` from `User` model name
7. **Types**: TypeScript interfaces for association config

---

## 3. Desired End State

### API Design

```typescript
// Schema (already exists)
const usersTable = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull(),
});

const postsTable = pgTable('posts', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body'),
  userId: integer('user_id').references(() => usersTable.id),
});

const commentsTable = pgTable('comments', {
  id: serial('id').primaryKey(),
  body: text('body').notNull(),
  postId: integer('post_id').references(() => postsTable.id),
  userId: integer('user_id').references(() => usersTable.id),
});

// Model declarations
class User extends Model(usersTable) {
  static hasMany = {
    posts: { model: () => Post }  // Infers foreignKey: 'userId'
  };
}

class Post extends Model(postsTable) {
  static belongsTo = {
    user: { model: () => User }  // Infers foreignKey: 'userId'
  };

  static hasMany = {
    comments: { model: () => Comment, foreignKey: 'postId' }  // Explicit FK
  };
}

class Comment extends Model(commentsTable) {
  static belongsTo = {
    post: { model: () => Post },
    user: { model: () => User, foreignKey: 'userId' }  // Explicit FK
  };
}
```

### Usage Examples

```typescript
// Lazy loading - belongsTo
const post = await Post.find(1);
const author = await post.user;  // Loads User record, returns User instance
const authorAgain = await post.user;  // Returns cached instance (no query)

// Lazy loading - hasMany
const user = await User.find(1);
const posts = await user.posts;  // Loads all Post records, returns Post[]
const postsAgain = await user.posts;  // Returns cached array (no query)

// Association proxy methods - hasMany
const user = await User.find(1);
await user.posts.count();  // SELECT COUNT(*) - does NOT load all posts
await user.posts.build({ title: 'Draft' });  // Returns unsaved Post with userId set
await user.posts.create({ title: 'Published' });  // Creates and saves Post with userId

// Reload association (clear cache)
const user = await User.find(1);
await user.posts;  // Cached
await user.reload();  // Clears all caches
await user.posts;  // Fresh query
```

---

## 4. What We're NOT Doing

**Explicitly excluded from AR5**:

| Feature | Reason | Planned For |
|---------|--------|-------------|
| `hasOne` | Lower priority, trivial addition later | AR6 |
| `hasMany :through` | Requires join logic | AR6 |
| `hasManyAndBelongsToMany` | Complex join tables | AR6 |
| Eager loading (`includes()`) | Requires QueryBuilder changes | AR6 |
| N+1 detection | Optimization layer | AR6 |
| Inverse associations | Auto-set `post.user` when `user.posts.create()` | AR6 |
| Dependent destroy | `has_many :posts, dependent: :destroy` | AR6 |
| Counter caches | `posts_count` column | AR9 |
| Polymorphic associations | `commentable_type`, `commentable_id` | AR9 |

---

## 5. Implementation Approach

### Architecture Decision: Thunk Pattern for Circular References

Models reference each other (`User` -> `Post` -> `User`), causing circular dependency issues. Solution: **thunk pattern** with lazy resolution.

```typescript
static belongsTo = {
  user: { model: () => User }  // Function returns model class when called
};
```

The `() => User` thunk is evaluated at association resolution time, not declaration time.

### Architecture Decision: CollectionProxy from the Start

**Decision**: `hasMany` returns a CollectionProxy immediately (not a raw Promise).

**Rationale**: Implementing array-then-proxy creates throwaway code. Phase 4 directly implements CollectionProxy to:
1. Avoid writing code that will be replaced
2. Keep implementation clean
3. Deliver proxy methods (`.count()`, `.build()`, `.create()`) alongside basic loading

The CollectionProxy:
1. Acts like a Promise (can be awaited to get array)
2. Has methods like `.count()`, `.build()`, `.create()`
3. Uses the owner's `_associations` cache for loaded data

```typescript
const proxy = user.posts;  // Returns CollectionProxy (not a query yet)
await proxy;  // Executes query, returns Post[]
await proxy.count();  // Executes COUNT query
proxy.build({ title: 'x' });  // Sync, returns unsaved Post
await proxy.create({ title: 'x' });  // Executes INSERT
```

### Architecture Decision: Cache in Instance

Loaded associations cached in `_associations` on the instance:

```typescript
class ModelInstance {
  _data: Record<string, unknown>;
  _persisted: boolean;
  _errors: Record<string, string[]>;
  _associations: Record<string, unknown>;  // NEW: { user: User, posts: Post[] }
}
```

Cache cleared on `reload()`.

### Foreign Key Inference

**belongsTo**: Convention: `belongsTo :user` -> foreignKey `userId` (associationName + 'Id')

```typescript
function inferBelongsToForeignKey(associationName: string): string {
  // 'user' -> 'userId'
  // 'authorUser' -> 'authorUserId'
  return associationName + 'Id';
}
```

**hasMany**: Uses parent model's **class name** (PascalCase), not table name:
- `User.hasMany :posts` -> Post must have `userId` column
- Parent class name `User` -> foreignKey `userId`

```typescript
function inferHasManyForeignKey(parentModelName: string): string {
  // 'User' -> 'userId'
  // 'BlogPost' -> 'blogPostId'
  return parentModelName.charAt(0).toLowerCase() + parentModelName.slice(1) + 'Id';
}
```

**CRITICAL**: The `parentModelName` parameter must be the **class name** (e.g., `"User"`), NOT the table name (e.g., `"users"`). Passing table name would produce incorrect foreign keys like `"usersId"` instead of `"userId"`.

---

## 6. Phased Implementation

### Phase 1: Association Types and Infrastructure

**Goal**: Define TypeScript types and add storage for association metadata.

**Files to modify**:
- `src/lib/activerecordjs/types.ts` - Add association type definitions
- `src/lib/activerecordjs/model.ts` - Add static association placeholders

**Changes**:

1. Add to `types.ts`:
```typescript
// Association configuration types
export type ModelThunk = () => any;  // Returns a Model class

export interface BelongsToConfig {
  model: ModelThunk;
  foreignKey?: string;  // Optional, inferred from association name
}

export interface HasManyConfig {
  model: ModelThunk;
  foreignKey?: string;  // Optional, inferred from parent model name
}

export type BelongsToDeclarations = Record<string, BelongsToConfig>;
export type HasManyDeclarations = Record<string, HasManyConfig>;
```

2. Add to `ModelClass` in `model.ts`:
```typescript
// Association declarations
static belongsTo: BelongsToDeclarations = {};
static hasMany: HasManyDeclarations = {};
```

3. Add instance cache in constructor (after line 116 `this._persisted = persisted;` and before the Proxy return):
```typescript
// Instance state for associations
this._associations = {};
```

Also add property declaration at the top of the instance properties:
```typescript
_associations: Record<string, unknown> = {};
```

**Success Criteria**:
- [ ] Types compile without errors
- [ ] Models can declare `static belongsTo` and `static hasMany`
- [ ] Instance has `_associations` cache object

---

### Phase 2: Foreign Key Inference

**Goal**: Implement foreign key inference logic.

**Files to create**:
- `src/lib/activerecordjs/associations.ts` - Association resolution utilities

**Changes**:

1. Create `associations.ts`:
```typescript
import type { BelongsToConfig, HasManyConfig } from './types';

/**
 * Infer foreign key from association name.
 * 'user' -> 'userId'
 * 'authorUser' -> 'authorUserId'
 */
export function inferBelongsToForeignKey(associationName: string): string {
  return associationName + 'Id';
}

/**
 * Infer foreign key from parent model's CLASS NAME (PascalCase).
 *
 * IMPORTANT: Pass the model's class name (e.g., 'User'), NOT the table name (e.g., 'users').
 *
 * Parent 'User' -> 'userId'
 * Parent 'BlogPost' -> 'blogPostId'
 */
export function inferHasManyForeignKey(parentModelName: string): string {
  // Convert 'User' to 'userId', 'BlogPost' to 'blogPostId'
  return parentModelName.charAt(0).toLowerCase() + parentModelName.slice(1) + 'Id';
}

/**
 * Resolve the foreign key for a belongsTo association.
 */
export function resolveBelongsToForeignKey(
  associationName: string,
  config: BelongsToConfig
): string {
  return config.foreignKey ?? inferBelongsToForeignKey(associationName);
}

/**
 * Resolve the foreign key for a hasMany association.
 *
 * @param parentModelName - The parent model's CLASS NAME (PascalCase), e.g., 'User'
 * @param config - The hasMany configuration
 */
export function resolveHasManyForeignKey(
  parentModelName: string,
  config: HasManyConfig
): string {
  return config.foreignKey ?? inferHasManyForeignKey(parentModelName);
}
```

**Success Criteria**:
- [ ] `inferBelongsToForeignKey('user')` returns `'userId'`
- [ ] `inferHasManyForeignKey('User')` returns `'userId'`
- [ ] `inferHasManyForeignKey('BlogPost')` returns `'blogPostId'`
- [ ] Explicit foreign keys override inference
- [ ] Unit tests pass for all inference cases

---

### Phase 3: BelongsTo Implementation

**Goal**: Implement `belongsTo` with lazy loading.

**Files to modify**:
- `src/lib/activerecordjs/model.ts` - Enhance Proxy handler, add loader
- `src/lib/activerecordjs/associations.ts` - Add belongsTo loader

**Changes**:

1. Add import to top of `model.ts`:
```typescript
import { loadBelongsTo } from './associations';
```

2. Add belongsTo loader to `associations.ts`:
```typescript
/**
 * Load a belongsTo association.
 */
export async function loadBelongsTo(
  instance: any,
  associationName: string,
  config: BelongsToConfig
): Promise<any> {
  const foreignKey = resolveBelongsToForeignKey(associationName, config);
  const foreignKeyValue = instance._data[foreignKey];

  if (foreignKeyValue == null) {
    return null;  // No foreign key set
  }

  const RelatedModel = config.model();
  return RelatedModel.find(foreignKeyValue);
}
```

3. Enhance Proxy `get` handler in `model.ts`:
```typescript
get(target, prop: string) {
  // Instance properties and methods first
  if (prop in target || prop.startsWith('_')) {
    return (target as any)[prop];
  }

  // Check for belongsTo association
  const ModelClass = target.constructor as any;
  if (ModelClass.belongsTo && prop in ModelClass.belongsTo) {
    // Return cached or load
    if (prop in target._associations) {
      return Promise.resolve(target._associations[prop]);
    }
    return loadBelongsTo(target, prop, ModelClass.belongsTo[prop])
      .then(result => {
        target._associations[prop] = result;
        return result;
      });
  }

  // Then check data
  return target._data[prop];
}
```

4. Clear associations on `reload()`:
```typescript
async reload(): Promise<this> {
  // ... existing code ...
  this._associations = {};  // Clear association cache
  return this;
}
```

**Success Criteria**:
- [ ] `post.user` returns Promise that resolves to User instance
- [ ] Subsequent `post.user` returns cached value (no DB query)
- [ ] `post.reload()` clears the cache
- [ ] `null` foreign key returns `null`
- [ ] Unit tests for belongsTo lazy loading
- [ ] Integration tests with real database

---

### Phase 4: HasMany with CollectionProxy

**Goal**: Implement `hasMany` with CollectionProxy from the start.

**Note**: This phase directly implements CollectionProxy rather than a temporary array implementation. This avoids throwaway code and delivers the full hasMany feature in one phase.

**Files to create**:
- `src/lib/activerecordjs/collection-proxy.ts` - CollectionProxy class

**Files to modify**:
- `src/lib/activerecordjs/model.ts` - Add Proxy handler for hasMany
- `src/lib/activerecordjs/associations.ts` - Export types needed by CollectionProxy

**Changes**:

1. Add import to top of `model.ts`:
```typescript
import { loadBelongsTo } from './associations';
import { CollectionProxy } from './collection-proxy';
```

2. Create `collection-proxy.ts`:
```typescript
import type { HasManyConfig } from './types';
import { resolveHasManyForeignKey } from './associations';

/**
 * CollectionProxy wraps a hasMany association.
 * - Awaitable: `await user.posts` returns Post[]
 * - Has methods: `.count()`, `.build()`, `.create()`
 */
export class CollectionProxy<T> implements PromiseLike<T[]> {
  private readonly owner: any;
  private readonly associationName: string;
  private readonly config: HasManyConfig;
  private readonly parentModelName: string;

  constructor(
    owner: any,
    associationName: string,
    config: HasManyConfig,
    parentModelName: string
  ) {
    this.owner = owner;
    this.associationName = associationName;
    this.config = config;
    this.parentModelName = parentModelName;
  }

  /**
   * Load the association (uses owner's _associations cache).
   */
  private async load(): Promise<T[]> {
    // Check instance cache first
    if (this.associationName in this.owner._associations) {
      return this.owner._associations[this.associationName] as T[];
    }

    const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
    const primaryKeyValue = this.owner._data[this.owner.constructor.primaryKey];

    if (primaryKeyValue == null) {
      const result: T[] = [];
      this.owner._associations[this.associationName] = result;
      return result;
    }

    const RelatedModel = this.config.model();
    const result = await RelatedModel.where({ [foreignKey]: primaryKeyValue }).all();
    this.owner._associations[this.associationName] = result;
    return result;
  }

  /**
   * Implement PromiseLike for `await user.posts`.
   */
  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.load().then(onfulfilled, onrejected);
  }

  /**
   * Count related records without loading them all.
   */
  async count(): Promise<number> {
    const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
    const primaryKeyValue = this.owner._data[this.owner.constructor.primaryKey];

    if (primaryKeyValue == null) {
      return 0;
    }

    const RelatedModel = this.config.model();
    return RelatedModel.where({ [foreignKey]: primaryKeyValue }).count();
  }

  /**
   * Build a new related record (not saved) with foreign key set.
   */
  build(attrs: Record<string, unknown> = {}): T {
    const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
    const primaryKeyValue = this.owner._data[this.owner.constructor.primaryKey];

    const RelatedModel = this.config.model();
    return RelatedModel.build({
      ...attrs,
      [foreignKey]: primaryKeyValue
    }) as T;
  }

  /**
   * Create and save a new related record with foreign key set.
   */
  async create(attrs: Record<string, unknown> = {}): Promise<T> {
    const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
    const primaryKeyValue = this.owner._data[this.owner.constructor.primaryKey];

    const RelatedModel = this.config.model();
    const instance = await RelatedModel.create({
      ...attrs,
      [foreignKey]: primaryKeyValue
    });

    // Invalidate cache so next load gets fresh data
    if (this.associationName in this.owner._associations) {
      delete this.owner._associations[this.associationName];
    }

    return instance as T;
  }

  /**
   * Clear the loaded cache.
   */
  reset(): void {
    if (this.associationName in this.owner._associations) {
      delete this.owner._associations[this.associationName];
    }
  }
}
```

3. Update Proxy `get` handler in `model.ts` to return CollectionProxy for hasMany:
```typescript
// Check for hasMany association
if (ModelClass.hasMany && prop in ModelClass.hasMany) {
  // Return a CollectionProxy
  // CRITICAL: Use ModelClass.name (class name like 'User'), NOT ModelClass.tableName
  return new CollectionProxy(
    target,
    prop,
    ModelClass.hasMany[prop],
    ModelClass.name  // Class name (e.g., 'User'), not table name (e.g., 'users')
  );
}
```

**CRITICAL**: The fourth argument to `CollectionProxy` must be `ModelClass.name` (the class name, e.g., `"User"`), NOT `ModelClass.tableName` (e.g., `"users"`). The `inferHasManyForeignKey()` function expects a PascalCase class name to produce the correct foreign key (e.g., `"User"` -> `"userId"`). Passing `"users"` would incorrectly produce `"usersId"`.

**Note**: The CollectionProxy doesn't cache itself on the instance. Each property access returns a new proxy, but they all share the owner's `_associations` cache for the loaded data. This allows multiple references to `user.posts` to share cached data while still returning fresh proxy objects.

**Success Criteria**:
- [ ] `await user.posts` returns `Post[]`
- [ ] Subsequent `await user.posts` returns cached array (one DB query)
- [ ] `await user.posts.count()` returns number without loading all records
- [ ] `user.posts.build({ title: 'x' })` returns unsaved Post with userId set
- [ ] `await user.posts.create({ title: 'x' })` creates Post with userId and invalidates cache
- [ ] Empty array for unsaved owner records
- [ ] Unit tests for CollectionProxy
- [ ] Integration tests for all proxy methods

---

### Phase 5: Tests and Polish

**Goal**: Comprehensive test coverage and documentation.

**Files to create**:
- `src/lib/activerecordjs/associations.test.ts` - Unit tests
- `src/lib/activerecordjs/associations.integration.test.ts` - Integration tests

**Files to modify**:
- `src/lib/activerecordjs/fixtures/schema.ts` - Add comments table if needed
- `src/lib/activerecordjs/fixtures/models.ts` - Add Comment model, add associations
- `src/lib/activerecordjs/index.ts` - Export new types

**Test Cases**:

**Unit tests** (mocked DB):
- [ ] `inferBelongsToForeignKey` inference
- [ ] `inferHasManyForeignKey` inference (with PascalCase class names)
- [ ] Explicit foreignKey overrides inference
- [ ] Association declarations work on subclass

**Integration tests** (real DB):

*belongsTo*:
- [ ] Load related record via belongsTo
- [ ] Null foreign key returns null
- [ ] Caching works (one query)
- [ ] reload() clears cache
- [ ] Custom foreignKey works

*hasMany*:
- [ ] Load related records via hasMany
- [ ] Empty array for no matches
- [ ] Empty array for unsaved owner
- [ ] Caching works (one query)
- [ ] reload() clears cache
- [ ] Custom foreignKey works

*CollectionProxy*:
- [ ] `count()` returns correct count
- [ ] `count()` doesn't load all records (verify with spy)
- [ ] `build()` returns unsaved with FK set
- [ ] `build()` works on unsaved owner (FK is null/undefined)
- [ ] `create()` saves record with FK
- [ ] `create()` invalidates cache
- [ ] Chain: `user.posts.create()` then `user.posts` includes new

**Success Criteria**:
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] TypeScript compiles without errors
- [ ] No regressions in existing tests (~198)
- [ ] Exports updated in index.ts

---

## 7. Testing Strategy

### Test File Structure

```
src/lib/activerecordjs/
  associations.test.ts           # Unit tests (mocked)
  associations.integration.test.ts  # Integration tests (real DB)
```

### Test Fixtures

Add to `schema.ts`:
```typescript
export const commentsTable = pgTable('comments', {
  id: serial('id').primaryKey(),
  body: text('body').notNull(),
  postId: integer('post_id').references(() => postsTable.id),
  userId: integer('user_id').references(() => usersTable.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});
```

Add to `models.ts` (with associations):
```typescript
export class User extends Model(usersTable) {
  static hasMany = {
    posts: { model: () => Post },
    comments: { model: () => Comment }
  };
}

export class Post extends Model(postsTable) {
  static belongsTo = {
    user: { model: () => User }
  };
  static hasMany = {
    comments: { model: () => Comment }
  };
}

export class Comment extends Model(commentsTable) {
  static belongsTo = {
    post: { model: () => Post },
    user: { model: () => User }
  };
}
```

### Test Commands

```bash
# Run association tests
bun test src/lib/activerecordjs/associations.test.ts
bun test src/lib/activerecordjs/associations.integration.test.ts

# Run all ActiveRecordJS tests (verify no regressions)
bun test --filter "activerecord"

# TypeScript check
bun run check
```

---

## 8. Migration Notes

**Breaking changes**: None. This is purely additive.

**Database migration**: If adding `comments` table for tests:
```sql
CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL,
  post_id INTEGER REFERENCES posts(id),
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 9. File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/activerecordjs/types.ts` | MODIFY | Add association types |
| `src/lib/activerecordjs/model.ts` | MODIFY | Add static declarations, enhance Proxy, add `_associations` (after line 116), add imports |
| `src/lib/activerecordjs/associations.ts` | CREATE | FK inference, loaders |
| `src/lib/activerecordjs/collection-proxy.ts` | CREATE | CollectionProxy class |
| `src/lib/activerecordjs/associations.test.ts` | CREATE | Unit tests |
| `src/lib/activerecordjs/associations.integration.test.ts` | CREATE | Integration tests |
| `src/lib/activerecordjs/fixtures/schema.ts` | MODIFY | Add comments table |
| `src/lib/activerecordjs/fixtures/models.ts` | MODIFY | Add associations to models |
| `src/lib/activerecordjs/index.ts` | MODIFY | Export new types |

---

## 10. Success Criteria

### Functional Requirements

- [ ] `belongsTo` declaration works with lazy loading
- [ ] `hasMany` declaration works with lazy loading
- [ ] Foreign key inference: `user` -> `userId` (belongsTo)
- [ ] Foreign key inference: `User` (class name) -> `userId` (hasMany)
- [ ] Manual foreign key override works
- [ ] Association caching prevents duplicate queries
- [ ] `reload()` clears association cache
- [ ] `CollectionProxy.count()` runs COUNT query
- [ ] `CollectionProxy.build()` returns unsaved with FK
- [ ] `CollectionProxy.create()` saves with FK and invalidates cache

### Quality Requirements

- [ ] TypeScript compiles without errors (`bun run check`)
- [ ] All new tests pass
- [ ] No regressions in existing ~198 tests
- [ ] Lint passes (`bun run lint`)

### Documentation

- [ ] Update `.omc/notepads/activerecordjs/plan.md` to mark AR5 complete
- [ ] Add any learnings to `.omc/notepads/activerecordjs/learnings.md`
- [ ] Add any decisions to `.omc/notepads/activerecordjs/decisions.md`

---

## 11. Commit Strategy

### Recommended Commits

1. **Phase 1**: "AR5: Add association types and infrastructure"
2. **Phase 2**: "AR5: Implement foreign key inference"
3. **Phase 3**: "AR5: Implement belongsTo with lazy loading"
4. **Phase 4**: "AR5: Implement hasMany with CollectionProxy"
5. **Phase 5**: "AR5: Add comprehensive test coverage"

Each commit should:
- Pass all tests
- Pass TypeScript check
- Pass lint
- Be independently reviewable

---

## 12. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Circular reference issues | Medium | High | Thunk pattern `() => Model` |
| Proxy conflicts with existing behavior | Low | Medium | Careful ordering in get handler |
| TypeScript complexity | Medium | Medium | Use `any` where helpful per PRD |
| Cache staleness | Low | Low | Document behavior, provide `reload()` |

---

## 13. Open Questions (Resolved)

1. **Eager loading syntax?** - Deferred to AR6. Will likely use `includes()`.
2. **How to type association returns?** - Use `any` liberally. Full typing is AR9 polish.
3. **Cache invalidation on related save?** - Not implemented. User calls `reload()`. AR6 may add automatic invalidation.
4. **Should hasMany return CollectionProxy from start?** - YES. Implementing array-then-proxy creates throwaway code. Phase 4 directly implements CollectionProxy.

---

## 14. Critical Implementation Notes

### Foreign Key Inference - MUST READ

The `inferHasManyForeignKey()` function expects a **PascalCase class name** as input:

| Input | Output | Correct? |
|-------|--------|----------|
| `"User"` | `"userId"` | YES |
| `"BlogPost"` | `"blogPostId"` | YES |
| `"users"` | `"usersId"` | NO - wrong input! |

When calling `CollectionProxy` or `loadHasMany`:
- **CORRECT**: `ModelClass.name` (class name, e.g., `"User"`)
- **WRONG**: `ModelClass.tableName` (table name, e.g., `"users"`)

### Required Imports in model.ts

Phase 3 adds:
```typescript
import { loadBelongsTo } from './associations';
```

Phase 4 adds:
```typescript
import { CollectionProxy } from './collection-proxy';
```

Final imports should be:
```typescript
import { loadBelongsTo } from './associations';
import { CollectionProxy } from './collection-proxy';
```

### _associations Initialization Location

In the Model constructor, add `this._associations = {}` after line 116 (`this._persisted = persisted;`) and before the Proxy return statement.

---

*Plan ready for implementation.*
