# AR6: hasOne, HABTM, Eager Loading, Dependent Options - Implementation Plan

> **Created**: 2026-01-27
> **Status**: Ready for Implementation
> **Depends On**: AR5 (Associations Core) - COMPLETE
> **Estimated Effort**: 3-5 days
> **Phases**: 6 (each independently testable and committable)

---

## 1. Executive Summary

AR6 completes the association system by adding four pillars missing from AR5:

1. **hasOne** -- FK on the related model (like hasMany but returns a single record)
2. **HABTM** -- many-to-many via join table (e.g., Post HABTM Tags via `posts_tags`)
3. **Eager loading** -- `Model.includes('posts')` to batch-load associations and prevent N+1, using a separate-query strategy (no JOINs needed)
4. **dependent option** -- `dependent: 'destroy' | 'nullify' | 'restrict'` on hasMany/hasOne to handle child lifecycle on parent destroy

Secondary deliverables (should-have):
5. **hasMany :through** -- traverse intermediary associations (e.g., User hasMany comments through posts)
6. **Inverse association setting** -- creating via proxy pre-sets the reverse association on the child
7. **Extended CollectionProxy** -- `.ids()`, `.empty()`, `.size()`, `.includes(record)`

Nice-to-have:
8. **Association query scoping** -- `user.posts.where({ published: true })`

---

## 2. Current State Analysis

### Existing Architecture (post-AR5)

**Files and line counts:**
| File | Lines | Purpose |
|------|-------|---------|
| `model.ts` | 573 | Model factory, Proxy handler (lines 127-171), CRUD, query builder entry points |
| `query-builder.ts` | 193 | WHERE/ORDER/LIMIT/OFFSET -- **no JOINs, no IN clause** |
| `associations.ts` | 66 | FK inference (`inferBelongsToForeignKey`, `inferHasManyForeignKey`), `loadBelongsTo` |
| `collection-proxy.ts` | 123 | CollectionProxy: `PromiseLike`, `.count()`, `.build()`, `.create()`, `.reset()` |
| `types.ts` | 87 | `BelongsToConfig`, `HasManyConfig`, `ModelThunk`, lifecycle hook types |
| `errors.ts` | 42 | `RecordNotFoundError`, `ValidationError` |
| `connection.ts` | 76 | AsyncLocalStorage-based connection, pool support |
| `fixtures/schema.ts` | 27 | `usersTable`, `postsTable`, `commentsTable` |
| `fixtures/models.ts` | 29 | `User`, `Post`, `Comment` with belongsTo/hasMany |

**Proxy handler priority** (model.ts lines 128-161):
1. Instance properties and methods (`prop in target || prop.startsWith('_')`)
2. belongsTo associations (returns Promise, caches in `_associations`)
3. hasMany associations (returns new CollectionProxy each time, shares `_associations` cache)
4. `_data` attributes (raw column values)

**Key patterns established:**
- Static declarations: `static belongsTo = {}`, `static hasMany = {}`
- Thunk pattern for circular refs: `model: () => Post`
- FK inference from model class name (PascalCase), not table name
- `_associations` cache on instance, cleared by `reload()`
- CollectionProxy implements `PromiseLike<T[]>`

**QueryBuilder limitations:**
- Only supports `eq` conditions and raw SQL in WHERE
- No `IN` clause support -- needed for eager loading batch queries
- No JOINs -- confirmed we use separate-query strategy for eager loading

---

## 3. Desired End State

### API Design

```typescript
// --- hasOne ---
class User extends Model(usersTable) {
  static hasOne = {
    profile: { model: () => Profile }  // FK 'userId' on profiles table
  };
  static hasMany = {
    posts: { model: () => Post, dependent: 'destroy' },
    comments: { model: () => Comment }
  };
}

const user = await User.find(1);
const profile = await user.profile;  // Returns single Profile or null

// --- HABTM ---
class Post extends Model(postsTable) {
  static hasAndBelongsToMany = {
    tags: {
      model: () => Tag,
      joinTable: 'posts_tags'  // Optional: inferred as 'posts_tags' from sorted table names
    }
  };
}

const post = await Post.find(1);
const tags = await post.tags;          // Tag[]
await post.tags.count();               // Number
await post.tags.add(tag);              // INSERT into join table
await post.tags.remove(tag);           // DELETE from join table
await post.tags.ids();                 // number[]

// --- Eager Loading ---
const users = await User.includes('posts').all();
// Executes: SELECT * FROM users
// Then:     SELECT * FROM posts WHERE user_id IN (1, 2, 3, ...)
// Each user.posts is pre-populated (no additional queries)

const posts = await Post.includes('user', 'comments').all();
// Loads posts, then batch-loads users and comments

// Chainable with where/order/limit
const recentUsers = await User.includes('posts').where({ active: true }).limit(10).all();

// --- Dependent Option ---
class User extends Model(usersTable) {
  static hasMany = {
    posts: { model: () => Post, dependent: 'destroy' }    // Destroy children
  };
  static hasOne = {
    profile: { model: () => Profile, dependent: 'nullify' } // Set FK to null
  };
}

await user.destroy();
// With 'destroy': deletes all user.posts recursively
// With 'nullify': sets posts.userId = null
// With 'restrict': throws if children exist

// --- hasMany :through ---
class User extends Model(usersTable) {
  static hasMany = {
    posts: { model: () => Post },
    comments: { model: () => Comment, through: 'posts' }
  };
}

const user = await User.find(1);
const comments = await user.comments;  // All comments on all of user's posts

// --- Inverse Association ---
const post = await user.posts.create({ title: 'Hello' });
const author = await post.user;  // Already set (no DB query needed)

// --- Extended CollectionProxy ---
await user.posts.ids();                // [1, 2, 3]
await user.posts.empty();             // boolean
await user.posts.size();              // alias for count()
await user.posts.includes(somePost);  // boolean - checks by ID
```

---

## 4. What We Are NOT Doing

| Feature | Reason | Planned For |
|---------|--------|-------------|
| Nested eager loading (`includes({ posts: 'comments' })`) | Complexity; separate-query strategy handles one level well | AR7 |
| Polymorphic associations | `commentable_type`/`commentable_id` pattern | AR9 |
| Counter caches | `posts_count` column auto-updates | AR9 |
| N+1 detection/warnings | Dev-mode logging | AR7 |
| Preloading in `find` | `User.find(1, includes: ['posts'])` | AR7 |
| Self-referential associations | `user.friends` through join table to same model | AR9 |
| Association callbacks (`after_add`, `after_remove`) | Low priority | AR9 |

---

## 5. Architecture Decisions

### Decision 1: Separate-Query Strategy for Eager Loading

**Decision**: Use batch SELECT with IN clause, NOT JOINs.

**Rationale**:
- QueryBuilder has no JOIN support; adding it is a major refactor
- Separate queries are simpler, debuggable, and avoid cartesian product issues
- Rails uses this strategy for `preload` (and it's the default for `includes` without conditions on the association)

**Implementation**:
```
Query 1: SELECT * FROM users WHERE active = true
Query 2: SELECT * FROM posts WHERE user_id IN (1, 2, 3)  -- batch by collected IDs
```

**Requires**: Adding `whereIn` support to QueryBuilder (new condition type).

### Decision 2: hasOne Returns Promise (Like belongsTo)

**Decision**: `hasOne` returns a Promise (like belongsTo), not a CollectionProxy.

**Rationale**: hasOne returns a single record or null. CollectionProxy's array-oriented API (`.count()`, `.build()`) doesn't fit. However, hasOne should still support `.build()` and `.create()` on the proxy -- we'll use a `SingularAssociationProxy` that is PromiseLike and has `.build()` and `.create()`.

**Simplified approach**: For initial implementation, hasOne will behave like belongsTo in the Proxy handler (return Promise, cache result). Build/create support can use a lightweight wrapper. To keep scope manageable, Phase 1 implements hasOne as a simple Promise-returning loader (like belongsTo). If time permits, a `SingularProxy` with `.build()`/`.create()` can be added.

### Decision 3: HABTM Join Table Convention

**Decision**: Join table name inferred from sorted, pluralized table names: `posts` + `tags` -> `posts_tags`.

**Override**: `joinTable: 'custom_table_name'`

**Join table schema convention**: Two columns named `{model1}Id` and `{model2}Id` (camelCase), mapped to `{model1_singular}_id` and `{model2_singular}_id` in the database.

### Decision 4: HABTM Gets Its Own CollectionProxy Subclass

**Decision**: Create `HABTMCollectionProxy` extending or paralleling `CollectionProxy`.

**Rationale**: HABTM needs `.add(record)` and `.remove(record)` which operate on the join table, not the target table. The FK-based `build()` and `create()` from CollectionProxy don't apply. HABTM needs a distinct proxy class.

### Decision 5: `dependent` Hooks Into `destroy()`

**Decision**: Process `dependent` option in the `destroy()` method, BEFORE the `beforeDestroy` hooks.

**Rationale**: Dependent handling is a data integrity concern that should execute before user-defined hooks can interfere. Order: dependent handling -> beforeDestroy -> DELETE -> afterDestroy.

**Actually, correction**: Rails processes dependent AFTER beforeDestroy but BEFORE the actual DELETE, as part of the destroy transaction. We'll follow Rails: beforeDestroy -> dependent handling -> DELETE -> afterDestroy.

### Decision 6: hasMany :through Uses Two-Step Loading

**Decision**: `through` associations load the intermediary, then collect the target.

```
user.comments (through: 'posts'):
  Step 1: Load user.posts -> [post1, post2]
  Step 2: Load comments WHERE postId IN (post1.id, post2.id)
```

This reuses eager-loading's `whereIn` infrastructure.

---

## 6. Phased Implementation

### Phase Dependency Graph

```
Phase 1: hasOne
    |
    v
Phase 2: QueryBuilder.whereIn + Eager Loading Infrastructure
    |
    +---> Phase 3: HABTM (needs whereIn for join table queries)
    |
    +---> Phase 4: hasMany :through (needs whereIn for batch loading)
    |
    v
Phase 5: Dependent Option (independent, but benefits from hasOne being done)
    |
    v
Phase 6: Extended CollectionProxy + Inverse + Scoping
```

Phases 3 and 4 can be done in parallel after Phase 2. Phase 5 is independent of 3/4.

---

### Phase 1: hasOne Association

**Goal**: Implement `hasOne` -- FK on the related model, returns single record or null.

**Files to modify:**
- `src/lib/activerecordjs/types.ts` -- Add `HasOneConfig` type
- `src/lib/activerecordjs/associations.ts` -- Add `loadHasOne`, `resolveHasOneForeignKey`
- `src/lib/activerecordjs/model.ts` -- Add `static hasOne = {}`, extend Proxy handler
- `src/lib/activerecordjs/fixtures/schema.ts` -- Add `profilesTable`
- `src/lib/activerecordjs/fixtures/models.ts` -- Add `Profile` model, add hasOne to User

**Implementation Details:**

1. **types.ts** -- Add HasOneConfig:
```typescript
export interface HasOneConfig {
  model: ModelThunk;
  foreignKey?: string;  // Optional, inferred from parent model name (like hasMany)
  dependent?: 'destroy' | 'nullify' | 'restrict';  // Phase 5, but declare type now
}

export type HasOneDeclarations = Record<string, HasOneConfig>;
```

2. **associations.ts** -- Add hasOne loader:
```typescript
/**
 * Resolve FK for hasOne (same logic as hasMany -- FK is on the related model).
 */
export function resolveHasOneForeignKey(
  parentModelName: string,
  config: HasOneConfig
): string {
  return config.foreignKey ?? inferHasManyForeignKey(parentModelName);
}

/**
 * Load a hasOne association. Returns single record or null.
 */
export async function loadHasOne(
  instance: any,
  associationName: string,
  config: HasOneConfig,
  parentModelName: string
): Promise<any> {
  const foreignKey = resolveHasOneForeignKey(parentModelName, config);
  const ModelClass = instance.constructor;
  const primaryKeyValue = instance._data[ModelClass.primaryKey];

  if (primaryKeyValue == null) return null;

  const RelatedModel = config.model();
  return RelatedModel.findBy({ [foreignKey]: primaryKeyValue });
}
```

3. **model.ts** -- Add static declaration and Proxy handler:
```typescript
// Add to static declarations
static hasOne: Record<string, any> = {};

// Add to Proxy get handler, AFTER belongsTo check, BEFORE hasMany check:
// Check for hasOne association
if (ModelClass.hasOne && prop in ModelClass.hasOne) {
  if (prop in target._associations) {
    return Promise.resolve(target._associations[prop]);
  }
  return loadHasOne(target, prop, ModelClass.hasOne[prop], ModelClass.modelName)
    .then((result: any) => {
      target._associations[prop] = result;
      return result;
    });
}
```

4. **fixtures/schema.ts** -- Add profiles table:
```typescript
export const profilesTable = pgTable('profiles', {
  id: serial('id').primaryKey(),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  userId: integer('user_id').references(() => usersTable.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});
```

5. **fixtures/models.ts** -- Add Profile, update User:
```typescript
class ProfileModel extends Model(profilesTable) {
  static belongsTo = {
    user: { model: () => UserModel }
  };
}

// Update UserModel:
class UserModel extends Model(usersTable) {
  static hasOne = {
    profile: { model: () => ProfileModel }
  };
  static hasMany = {
    posts: { model: () => PostModel },
    comments: { model: () => CommentModel }
  };
}

export const Profile = ProfileModel;
```

**Tests** (`src/lib/activerecordjs/hasone.integration.test.ts`):

| Test | Description |
|------|-------------|
| loads related record via hasOne | `user.profile` returns Profile instance |
| returns null when no related record exists | New user with no profile returns null |
| returns null for unsaved owner | `User.build({}).profile` returns null |
| caches the loaded association | Second `user.profile` returns cached (no query) |
| clears cache on reload() | `user.reload()` then `user.profile` re-queries |
| FK inference works | `userId` inferred from `User` model name |
| explicit foreignKey overrides inference | `foreignKey: 'ownerId'` works |

**Acceptance Criteria:**
- [ ] `await user.profile` returns single Profile or null
- [ ] Caching works (one DB query for repeated access)
- [ ] `reload()` clears hasOne cache
- [ ] FK inference matches hasMany convention
- [ ] All existing AR5 tests still pass
- [ ] TypeScript compiles cleanly

---

### Phase 2: QueryBuilder.whereIn + Eager Loading

**Goal**: Add `whereIn` to QueryBuilder, then implement `Model.includes()` for batch-loading associations.

**Files to modify:**
- `src/lib/activerecordjs/query-builder.ts` -- Add `whereIn` condition type and method
- `src/lib/activerecordjs/model.ts` -- Add `static includes()` entry point
- `src/lib/activerecordjs/eager-loader.ts` -- **NEW**: Eager loading engine

**Files to create:**
- `src/lib/activerecordjs/eager-loader.ts`

**Implementation Details:**

#### 2a. QueryBuilder.whereIn

Add a new condition type and chain method:

```typescript
// New condition type
type WhereCondition =
  | { type: 'eq'; column: string; value: unknown }
  | { type: 'in'; column: string; values: unknown[] }
  | { type: 'raw'; sql: string; params: unknown[] };

// New chain method
whereIn(column: string, values: unknown[]): QueryBuilder<T, Instance> {
  if (values.length === 0) {
    // Optimization: empty IN always returns nothing
    // Use a raw condition that is always false
    return this.clone({
      whereConditions: [
        ...this.state.whereConditions,
        { type: 'raw', sql: '1 = 0', params: [] }
      ]
    });
  }
  return this.clone({
    whereConditions: [
      ...this.state.whereConditions,
      { type: 'in', column, values }
    ]
  });
}

// In buildQuery, add handling:
} else if (condition.type === 'in') {
  const column = (this.table as any)[condition.column];
  query = query.where(inArray(column, condition.values));
}
```

**Note**: Drizzle ORM provides `inArray` from `drizzle-orm` for IN clause support. Import it alongside `eq`.

**IMPORTANT -- Fix `count()` method**: The `count()` method at query-builder.ts lines 169-186 has its own separate condition-handling loop that only handles `'eq'` and `'raw'` types. It does NOT share the `buildQuery` method used by `all()`/`first()`/`last()`. When adding the `'in'` condition type, `count()` MUST also handle it, or `whereIn` conditions will be silently ignored by `count()`.

Add to `count()` condition loop:
```typescript
} else if (condition.type === 'in') {
  const column = (this.table as any)[condition.column];
  query = query.where(inArray(column, condition.values));
}
```

**Refactoring recommendation**: Extract a shared `applyWhereConditions(query, conditions)` helper method to avoid duplicating condition logic between `buildQuery()` and `count()`. Both methods should call this helper. This prevents future condition types from being silently ignored by `count()`.

#### 2b. Eager Loading Engine

Create `src/lib/activerecordjs/eager-loader.ts`:

```typescript
/**
 * EagerLoader batches association loading to prevent N+1 queries.
 *
 * Strategy: Separate queries (not JOINs).
 *   1. Load main records
 *   2. Collect IDs from main records
 *   3. For each included association, run ONE query with WHERE ... IN (ids)
 *   4. Distribute loaded records back to their owners via _associations cache
 */
export async function eagerLoad(
  records: any[],
  associations: string[],
  modelClass: any
): Promise<void> {
  if (records.length === 0 || associations.length === 0) return;

  for (const assocName of associations) {
    if (modelClass.hasMany && assocName in modelClass.hasMany) {
      await eagerLoadHasMany(records, assocName, modelClass);
    } else if (modelClass.belongsTo && assocName in modelClass.belongsTo) {
      await eagerLoadBelongsTo(records, assocName, modelClass);
    } else if (modelClass.hasOne && assocName in modelClass.hasOne) {
      await eagerLoadHasOne(records, assocName, modelClass);
    } else if (modelClass.hasAndBelongsToMany && assocName in modelClass.hasAndBelongsToMany) {
      await eagerLoadHABTM(records, assocName, modelClass);
    } else {
      throw new Error(
        `Unknown association '${assocName}' on ${modelClass.modelName}`
      );
    }
  }
}
```

**eagerLoadHasMany**:
```typescript
async function eagerLoadHasMany(records: any[], assocName: string, modelClass: any) {
  const config = modelClass.hasMany[assocName];
  const foreignKey = resolveHasManyForeignKey(modelClass.modelName, config);
  const pk = modelClass.primaryKey;

  // Collect owner IDs
  const ownerIds = records.map(r => r._data[pk]).filter(id => id != null);
  if (ownerIds.length === 0) return;

  // Batch load
  const RelatedModel = config.model();
  const allRelated = await RelatedModel.where({}).whereIn(foreignKey, ownerIds).all();

  // NOTE: We need whereIn on QueryBuilder. The above uses the QueryBuilder chain.
  // Alternative approach: use the model's static where + whereIn chain.

  // Distribute to owners
  const grouped = new Map<unknown, any[]>();
  for (const record of allRelated) {
    const fkValue = record._data[foreignKey];
    if (!grouped.has(fkValue)) grouped.set(fkValue, []);
    grouped.get(fkValue)!.push(record);
  }

  for (const owner of records) {
    const ownerId = owner._data[pk];
    owner._associations[assocName] = grouped.get(ownerId) ?? [];
  }
}
```

**eagerLoadBelongsTo**:
```typescript
async function eagerLoadBelongsTo(records: any[], assocName: string, modelClass: any) {
  const config = modelClass.belongsTo[assocName];
  const foreignKey = resolveBelongsToForeignKey(assocName, config);

  // Collect FK values
  const fkValues = [...new Set(
    records.map(r => r._data[foreignKey]).filter(v => v != null)
  )];
  if (fkValues.length === 0) {
    // Set all to null
    for (const record of records) {
      record._associations[assocName] = null;
    }
    return;
  }

  // Batch load by primary key of related model
  const RelatedModel = config.model();
  const relatedPk = RelatedModel.primaryKey;
  const allRelated = await RelatedModel.where({}).whereIn(relatedPk, fkValues).all();

  // Index by PK
  const indexed = new Map<unknown, any>();
  for (const record of allRelated) {
    indexed.set(record._data[relatedPk], record);
  }

  for (const record of records) {
    const fkValue = record._data[foreignKey];
    record._associations[assocName] = indexed.get(fkValue) ?? null;
  }
}
```

**eagerLoadHasOne**: Same as eagerLoadHasMany but assigns single record (first match) instead of array.

#### 2c. Model.includes() Entry Point

Add to `model.ts`:

```typescript
// Static method
static includes(
  ...associations: string[]
): QueryBuilder<T, InstanceType<typeof this>> {
  const ModelClass = this;
  const builder = new QueryBuilder<T, InstanceType<typeof this>>(
    this.table,
    (data, persisted) => new ModelClass(data, persisted) as InstanceType<typeof this>,
    this
  );
  return builder.includes(...associations);
}
```

Add to `QueryBuilder`:

```typescript
// New state field
interface QueryState {
  // ... existing ...
  includesAssociations: string[];
}

// Chain method
includes(...associations: string[]): QueryBuilder<T, Instance> {
  return this.clone({
    includesAssociations: [...this.state.includesAssociations, ...associations]
  });
}

// Modify all() to trigger eager loading after main query
async all(): Promise<Instance[]> {
  const db = getGlobalConnection();
  const results = await this.buildQuery(db);
  const instances = results.map((r: any) => this.createInstance(r, true));

  // Eager load if includes were specified
  if (this.state.includesAssociations.length > 0) {
    await eagerLoad(instances, this.state.includesAssociations, this.modelClass);
  }

  return instances;
}
```

**Tests** (`src/lib/activerecordjs/eager-loading.integration.test.ts`):

| Test | Description |
|------|-------------|
| whereIn returns matching records | `User.where({}).whereIn('id', [1,2]).all()` |
| whereIn with empty array returns empty | `User.where({}).whereIn('id', []).all()` returns [] |
| includes loads hasMany associations | `User.includes('posts').all()` pre-populates posts |
| includes loads belongsTo associations | `Post.includes('user').all()` pre-populates user |
| includes loads hasOne associations | `User.includes('profile').all()` pre-populates profile |
| includes prevents N+1 (query count) | Verify only 2 queries for N users with posts |
| includes works with where clause | `User.includes('posts').where({ email: 'x' }).all()` |
| includes works with multiple associations | `Post.includes('user', 'comments').all()` |
| includes with no results is safe | `User.includes('posts').where({ email: 'nonexistent' }).all()` |
| includes works with limit | `User.includes('posts').limit(2).all()` loads 2 users with their posts |
| cached associations from includes prevent lazy load queries | After includes, `user.posts` returns cached |
| unknown association throws error | `User.includes('nonexistent')` throws |

**Acceptance Criteria:**
- [ ] `QueryBuilder.whereIn(col, values)` works correctly
- [ ] `whereIn` with empty array returns empty result set (no SQL error)
- [ ] `Model.includes('assocName').all()` batch-loads associations
- [ ] Multiple includes work: `includes('user', 'comments')`
- [ ] Chainable with `.where()`, `.order()`, `.limit()`
- [ ] Pre-loaded associations are cached in `_associations` (no lazy load triggered)
- [ ] Unknown association name throws descriptive error
- [ ] All existing tests pass

---

### Phase 3: HABTM (Has And Belongs To Many)

**Goal**: Implement many-to-many associations via join tables.

**Files to create:**
- `src/lib/activerecordjs/habtm-collection-proxy.ts` -- HABTMCollectionProxy

**Files to modify:**
- `src/lib/activerecordjs/types.ts` -- Add `HasAndBelongsToManyConfig`
- `src/lib/activerecordjs/associations.ts` -- Add HABTM FK inference, join table name inference
- `src/lib/activerecordjs/model.ts` -- Add `static hasAndBelongsToMany = {}`, extend Proxy handler
- `src/lib/activerecordjs/eager-loader.ts` -- Add `eagerLoadHABTM`
- `src/lib/activerecordjs/fixtures/schema.ts` -- Add `tagsTable`, `postsTagsTable`
- `src/lib/activerecordjs/fixtures/models.ts` -- Add `Tag` model, HABTM on Post

**Implementation Details:**

1. **types.ts**:
```typescript
export interface HasAndBelongsToManyConfig {
  model: ModelThunk;
  joinTable?: string;        // Optional, inferred from sorted table names
  foreignKey?: string;       // FK pointing to owner (e.g., 'postId')
  associationForeignKey?: string;  // FK pointing to target (e.g., 'tagId')
}

export type HABTMDeclarations = Record<string, HasAndBelongsToManyConfig>;
```

2. **associations.ts** -- Join table inference:
```typescript
/**
 * Infer join table name from two table names.
 * Sorts alphabetically and joins with underscore.
 * 'posts' + 'tags' -> 'posts_tags'
 * 'categories' + 'posts' -> 'categories_posts'
 */
export function inferJoinTableName(tableName1: string, tableName2: string): string {
  return [tableName1, tableName2].sort().join('_');
}

/**
 * Infer the FK column pointing to the owner model in a join table.
 * Owner 'Post' -> 'postId'
 */
export function inferHABTMForeignKey(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1) + 'Id';
}
```

3. **habtm-collection-proxy.ts**:

```typescript
/**
 * HABTMCollectionProxy wraps a many-to-many association via join table.
 * - Awaitable: `await post.tags` returns Tag[]
 * - .add(record): INSERT into join table
 * - .remove(record): DELETE from join table
 * - .ids(): returns target IDs
 * - .count(): COUNT via join table
 * - .empty(): boolean
 * - .includes(record): check membership
 */
export class HABTMCollectionProxy<T> implements PromiseLike<T[]> {
  constructor(
    private readonly owner: any,
    private readonly associationName: string,
    private readonly config: HasAndBelongsToManyConfig,
    private readonly ownerModelClass: any
  ) {}

  // Resolve join table name, FK columns
  private get joinTableName(): string { ... }
  private get foreignKey(): string { ... }        // Points to owner
  private get associationForeignKey(): string { ... }  // Points to target

  private async loadTargetIds(): Promise<number[]> {
    // SELECT association_fk FROM join_table WHERE fk = owner.id
    // Use raw SQL via db.execute since join table may not have a Drizzle schema
    // IMPORTANT: Column names must be snake_case for raw SQL (DB columns are snake_case)
    const db = getGlobalConnection();
    const ownerPK = this.owner._data[this.ownerModelClass.primaryKey];
    const fkCol = toSnakeCase(this.foreignKey);
    const assocFkCol = toSnakeCase(this.associationForeignKey);
    const result = await db.execute(
      sql`SELECT ${sql.raw(assocFkCol)}
          FROM ${sql.raw(this.joinTableName)}
          WHERE ${sql.raw(fkCol)} = ${ownerPK}`
    );
    return result.map(r => r[assocFkCol]);
  }

  private async load(): Promise<T[]> {
    if (this.associationName in this.owner._associations) {
      return this.owner._associations[this.associationName] as T[];
    }

    const targetIds = await this.loadTargetIds();
    if (targetIds.length === 0) {
      this.owner._associations[this.associationName] = [];
      return [];
    }

    const TargetModel = this.config.model();
    const result = await TargetModel.where({}).whereIn(TargetModel.primaryKey, targetIds).all();
    this.owner._associations[this.associationName] = result;
    return result;
  }

  then<TResult1 = T[], TResult2 = never>(...): Promise<TResult1 | TResult2> {
    return this.load().then(onfulfilled, onrejected);
  }

  async add(record: any): Promise<void> {
    // INSERT INTO join_table (fk, assoc_fk) VALUES (owner.id, record.id)
    // IMPORTANT: Use toSnakeCase() for DB column names in raw SQL
    const db = getGlobalConnection();
    const ownerPK = this.owner._data[this.ownerModelClass.primaryKey];
    const targetPK = record._data[this.config.model().primaryKey];
    const fkCol = toSnakeCase(this.foreignKey);
    const assocFkCol = toSnakeCase(this.associationForeignKey);
    await db.execute(
      sql`INSERT INTO ${sql.raw(this.joinTableName)}
          (${sql.raw(fkCol)}, ${sql.raw(assocFkCol)})
          VALUES (${ownerPK}, ${targetPK})
          ON CONFLICT DO NOTHING`
    );
    delete this.owner._associations[this.associationName]; // Invalidate cache
  }

  async remove(record: any): Promise<void> {
    // DELETE FROM join_table WHERE fk = owner.id AND assoc_fk = record.id
    // IMPORTANT: Use toSnakeCase() for DB column names in raw SQL
    const db = getGlobalConnection();
    const ownerPK = this.owner._data[this.ownerModelClass.primaryKey];
    const targetPK = record._data[this.config.model().primaryKey];
    const fkCol = toSnakeCase(this.foreignKey);
    const assocFkCol = toSnakeCase(this.associationForeignKey);
    await db.execute(
      sql`DELETE FROM ${sql.raw(this.joinTableName)}
          WHERE ${sql.raw(fkCol)} = ${ownerPK}
          AND ${sql.raw(assocFkCol)} = ${targetPK}`
    );
    delete this.owner._associations[this.associationName]; // Invalidate cache
  }

  async count(): Promise<number> { ... }  // COUNT on join table
  async ids(): Promise<number[]> { return this.loadTargetIds(); }
  async empty(): Promise<boolean> { return (await this.count()) === 0; }
  async includes(record: any): Promise<boolean> { ... }  // Check join table
  reset(): void { delete this.owner._associations[this.associationName]; }
}
```

**IMPORTANT**: HABTM uses raw SQL for join table operations because the join table might not have a Drizzle schema object defined. The `sql` template from drizzle-orm handles parameterization. Column names in the join table use snake_case in the database but camelCase in the config/inference. The raw SQL must use the actual database column names (snake_case). Add a helper to convert: `postId` -> `post_id`.

4. **model.ts** Proxy handler addition:
```typescript
// After hasMany check, before _data fallback:
if (ModelClass.hasAndBelongsToMany && prop in ModelClass.hasAndBelongsToMany) {
  return new HABTMCollectionProxy(
    target,
    prop,
    ModelClass.hasAndBelongsToMany[prop],
    ModelClass
  );
}
```

5. **eager-loader.ts** -- Add HABTM support:
```typescript
async function eagerLoadHABTM(records: any[], assocName: string, modelClass: any) {
  // 1. Collect owner IDs
  // 2. Batch query join table: SELECT * FROM join_table WHERE fk IN (ownerIds)
  // 3. Collect target IDs from join rows
  // 4. Batch query target model: SELECT * FROM targets WHERE id IN (targetIds)
  // 5. Distribute: group join rows by owner FK, map to target records
}
```

6. **Fixture tables**:
```typescript
// schema.ts
export const tagsTable = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: text('name').notNull()
});

export const postsTagsTable = pgTable('posts_tags', {
  postId: integer('post_id').references(() => postsTable.id).notNull(),
  tagId: integer('tag_id').references(() => tagsTable.id).notNull()
}, (t) => [
  primaryKey({ columns: [t.postId, t.tagId] })
]);
```

**Note on composite primary key**: The `primaryKey` import comes from `drizzle-orm/pg-core`. The composite unique constraint on `(postId, tagId)` is **required** for `ON CONFLICT DO NOTHING` in the `.add()` method to work correctly. Without it, PostgreSQL has no constraint to detect conflicts and `ON CONFLICT DO NOTHING` becomes a no-op.

**Note on snake_case**: The join table has database columns `post_id` and `tag_id`, but Drizzle maps them to `postId` and `tagId` in JS. When using raw SQL for HABTM queries, we must use the actual DB column names. The inference functions should produce the database column name (snake_case) for use in raw SQL. Add a `toSnakeCase` utility: `postId` -> `post_id`.

**Tests** (`src/lib/activerecordjs/habtm.integration.test.ts`):

| Test | Description |
|------|-------------|
| loads related records via HABTM | `post.tags` returns Tag[] |
| returns empty array when no associations | New post with no tags |
| add() creates join table entry | `post.tags.add(tag)` |
| add() is idempotent (ON CONFLICT DO NOTHING) | Adding same tag twice doesn't error |
| remove() deletes join table entry | `post.tags.remove(tag)` |
| remove() is safe for non-existent | Removing unlinked tag doesn't error |
| count() counts via join table | Correct count without loading records |
| ids() returns target IDs | Array of tag IDs |
| empty() returns boolean | True when no tags, false otherwise |
| includes(record) checks membership | True/false by ID |
| join table name inference | `posts` + `tags` -> `posts_tags` |
| explicit joinTable overrides inference | Custom table name works |
| cache invalidation on add/remove | Adding/removing clears cache |
| eager loading works with HABTM | `Post.includes('tags').all()` |

**Acceptance Criteria:**
- [ ] `await post.tags` returns Tag[] via join table
- [ ] `.add(tag)` inserts into join table
- [ ] `.remove(tag)` deletes from join table
- [ ] `.count()`, `.ids()`, `.empty()`, `.includes()` work correctly
- [ ] Join table name inferred correctly from sorted table names
- [ ] Explicit `joinTable` override works
- [ ] Eager loading works with HABTM associations
- [ ] Cache invalidation on `.add()` and `.remove()`
- [ ] All existing tests pass

---

### Phase 4: hasMany :through

**Goal**: Allow traversal through intermediary associations.

**Files to modify:**
- `src/lib/activerecordjs/types.ts` -- Add `through` to `HasManyConfig`
- `src/lib/activerecordjs/collection-proxy.ts` -- Support `through` in CollectionProxy (or create ThroughCollectionProxy)
- `src/lib/activerecordjs/model.ts` -- Detect `through` in hasMany handler
- `src/lib/activerecordjs/eager-loader.ts` -- Add `eagerLoadThrough`
- `src/lib/activerecordjs/fixtures/models.ts` -- Add through association to User

**Implementation Details:**

1. **types.ts** -- Extend HasManyConfig:
```typescript
export interface HasManyConfig {
  model: ModelThunk;
  foreignKey?: string;
  through?: string;  // Name of intermediary hasMany association
  dependent?: 'destroy' | 'nullify' | 'restrict';  // Phase 5
}
```

2. **Loading strategy for `through`**:

When `through` is specified, the loading changes fundamentally:
- **Without through**: `SELECT * FROM comments WHERE userId = ?`
- **With through (`comments` through `posts`)**:
  1. Load intermediary: `SELECT * FROM posts WHERE userId = ?`
  2. Collect intermediary IDs
  3. Load target: `SELECT * FROM comments WHERE postId IN (?)`

This means the CollectionProxy needs to detect `through` and use a two-step approach.

3. **CollectionProxy modification**:

Add a private method `loadThrough()`:
```typescript
private async loadThrough(): Promise<T[]> {
  const ModelClass = this.owner.constructor;
  const throughAssocName = this.config.through!;

  // Step 1: Load intermediary records
  const throughConfig = ModelClass.hasMany[throughAssocName];
  if (!throughConfig) {
    throw new Error(
      `Through association '${throughAssocName}' not found on ${ModelClass.modelName}`
    );
  }

  const throughFK = resolveHasManyForeignKey(this.parentModelName, throughConfig);
  const ownerPK = this.owner._data[ModelClass.primaryKey];
  if (ownerPK == null) return [];

  const ThroughModel = throughConfig.model();
  const intermediaries = await ThroughModel.where({ [throughFK]: ownerPK }).all();
  if (intermediaries.length === 0) return [];

  // Step 2: Load target records via intermediary
  const intermediaryIds = intermediaries.map((r: any) => r._data[ThroughModel.primaryKey]);
  const TargetModel = this.config.model();

  // The FK on the target points to the intermediary model
  const targetFK = resolveHasManyForeignKey(ThroughModel.modelName, this.config);
  return TargetModel.where({}).whereIn(targetFK, intermediaryIds).all();
}
```

**Rename existing `load()` to `loadDirect()`**, then create a new `load()` dispatcher:

The existing `load()` method in `collection-proxy.ts` contains the direct FK-based loading logic. Rename it to `loadDirect()` to distinguish it from the new through-loading path. Then create a new `load()` that dispatches:

```typescript
// Rename existing load() -> loadDirect()
private async loadDirect(): Promise<T[]> {
  // ... existing load() body (FK-based query) ...
}

// New load() dispatcher
private async load(): Promise<T[]> {
  if (this.associationName in this.owner._associations) {
    return this.owner._associations[this.associationName] as T[];
  }

  const result = this.config.through
    ? await this.loadThrough()
    : await this.loadDirect();

  this.owner._associations[this.associationName] = result;
  return result;
}
```

4. **Eager loading for through**:
```typescript
async function eagerLoadThrough(records: any[], assocName: string, modelClass: any) {
  const config = modelClass.hasMany[assocName];
  const throughAssocName = config.through;
  const throughConfig = modelClass.hasMany[throughAssocName];
  const pk = modelClass.primaryKey;

  // Step 1: Collect owner IDs
  const ownerIds = records.map(r => r._data[pk]).filter(id => id != null);
  if (ownerIds.length === 0) return;

  // Step 2: Batch load intermediaries
  const ThroughModel = throughConfig.model();
  const throughFK = resolveHasManyForeignKey(modelClass.modelName, throughConfig);
  const intermediaries = await ThroughModel.where({}).whereIn(throughFK, ownerIds).all();

  // Step 3: Batch load targets
  const intermediaryIds = intermediaries.map((r: any) => r._data[ThroughModel.primaryKey]);
  const TargetModel = config.model();
  const targetFK = resolveHasManyForeignKey(ThroughModel.modelName, config);
  const targets = await TargetModel.where({}).whereIn(targetFK, intermediaryIds).all();

  // Step 4: Build owner -> intermediaryIds -> targetRecords mapping
  // Group intermediaries by owner FK
  const intermediariesByOwner = new Map<unknown, any[]>();
  for (const inter of intermediaries) {
    const ownerId = inter._data[throughFK];
    if (!intermediariesByOwner.has(ownerId)) intermediariesByOwner.set(ownerId, []);
    intermediariesByOwner.get(ownerId)!.push(inter);
  }

  // Group targets by intermediary FK
  const targetsByIntermediary = new Map<unknown, any[]>();
  for (const target of targets) {
    const interId = target._data[targetFK];
    if (!targetsByIntermediary.has(interId)) targetsByIntermediary.set(interId, []);
    targetsByIntermediary.get(interId)!.push(target);
  }

  // Distribute to owners
  for (const owner of records) {
    const ownerId = owner._data[pk];
    const ownerIntermediaries = intermediariesByOwner.get(ownerId) ?? [];
    const ownerTargets: any[] = [];
    for (const inter of ownerIntermediaries) {
      const interId = inter._data[ThroughModel.primaryKey];
      const matched = targetsByIntermediary.get(interId) ?? [];
      ownerTargets.push(...matched);
    }
    owner._associations[assocName] = ownerTargets;
  }
}
```

5. **Model fixture**:
```typescript
class UserModel extends Model(usersTable) {
  static hasMany = {
    posts: { model: () => PostModel },
    comments: { model: () => CommentModel, through: 'posts' }
  };
}
```

**Tests** (`src/lib/activerecordjs/through.integration.test.ts`):

| Test | Description |
|------|-------------|
| loads records through intermediary | `user.comments` via posts |
| returns empty when no intermediaries | User with no posts -> no comments |
| returns empty when intermediaries have no targets | User with posts but no comments |
| throws for invalid through association name | `through: 'nonexistent'` |
| count works through intermediary | `user.comments.count()` |
| eager loading works with through | `User.includes('comments').all()` |
| through + direct hasMany coexist | User has both `posts` (direct) and `comments` (through) |

**Acceptance Criteria:**
- [ ] `await user.comments` loads comments through posts
- [ ] Empty intermediary returns empty targets
- [ ] Invalid `through` name throws descriptive error
- [ ] Eager loading batch-loads through associations
- [ ] Direct and through associations coexist on same model
- [ ] All existing tests pass

---

### Phase 5: Dependent Option

**Goal**: Implement `dependent: 'destroy' | 'nullify' | 'restrict'` on hasMany and hasOne.

**Files to modify:**
- `src/lib/activerecordjs/types.ts` -- Add `dependent` to HasManyConfig (already declared in Phase 1 for HasOneConfig)
- `src/lib/activerecordjs/model.ts` -- Hook dependent processing into `destroy()`
- `src/lib/activerecordjs/errors.ts` -- Add `DependentRestrictError`
- `src/lib/activerecordjs/associations.ts` -- Add `processDependentAssociations`

**Implementation Details:**

1. **errors.ts** -- New error:
```typescript
export class DependentRestrictError extends ActiveRecordJSError {
  constructor(modelName: string, associationName: string) {
    super(
      `Cannot destroy ${modelName}: dependent '${associationName}' records exist (restrict)`
    );
    this.name = 'DependentRestrictError';
  }
}
```

2. **associations.ts** -- Dependent processor:
```typescript
/**
 * Process dependent associations before destroying the owner.
 * Called from Model.destroy() after beforeDestroy hooks.
 *
 * Order of processing:
 *   1. 'restrict' checks (fail fast before any mutations)
 *   2. 'destroy' cascades
 *   3. 'nullify' updates
 */
export async function processDependentAssociations(instance: any): Promise<void> {
  const ModelClass = instance.constructor;
  const pk = ModelClass.primaryKey;
  const ownerPK = instance._data[pk];
  if (ownerPK == null) return;

  // Collect all associations with dependent option
  const dependentAssocs: Array<{
    name: string;
    type: 'hasMany' | 'hasOne';
    config: any;
    dependent: string;
  }> = [];

  if (ModelClass.hasMany) {
    for (const [name, config] of Object.entries(ModelClass.hasMany) as any) {
      if (config.dependent) {
        dependentAssocs.push({ name, type: 'hasMany', config, dependent: config.dependent });
      }
    }
  }
  if (ModelClass.hasOne) {
    for (const [name, config] of Object.entries(ModelClass.hasOne) as any) {
      if (config.dependent) {
        dependentAssocs.push({ name, type: 'hasOne', config, dependent: config.dependent });
      }
    }
  }

  if (dependentAssocs.length === 0) return;

  // Pass 1: Check all 'restrict' associations
  for (const assoc of dependentAssocs) {
    if (assoc.dependent !== 'restrict') continue;

    const fk = assoc.type === 'hasMany'
      ? resolveHasManyForeignKey(ModelClass.modelName, assoc.config)
      : resolveHasOneForeignKey(ModelClass.modelName, assoc.config);

    const RelatedModel = assoc.config.model();
    const count = await RelatedModel.where({ [fk]: ownerPK }).count();
    if (count > 0) {
      throw new DependentRestrictError(ModelClass.modelName, assoc.name);
    }
  }

  // Pass 2: Process 'destroy' associations
  for (const assoc of dependentAssocs) {
    if (assoc.dependent !== 'destroy') continue;

    const fk = assoc.type === 'hasMany'
      ? resolveHasManyForeignKey(ModelClass.modelName, assoc.config)
      : resolveHasOneForeignKey(ModelClass.modelName, assoc.config);

    const RelatedModel = assoc.config.model();
    const children = await RelatedModel.where({ [fk]: ownerPK }).all();

    // Destroy each child (triggers THEIR dependent processing recursively)
    for (const child of children) {
      await child.destroy();
    }
  }

  // Pass 3: Process 'nullify' associations
  for (const assoc of dependentAssocs) {
    if (assoc.dependent !== 'nullify') continue;

    const fk = assoc.type === 'hasMany'
      ? resolveHasManyForeignKey(ModelClass.modelName, assoc.config)
      : resolveHasOneForeignKey(ModelClass.modelName, assoc.config);

    const RelatedModel = assoc.config.model();
    // Batch update: SET fk = NULL WHERE fk = ownerPK
    const db = getGlobalConnection();
    await db.execute(
      sql`UPDATE ${sql.raw(RelatedModel.tableName)}
          SET ${sql.raw(toSnakeCase(fk))} = NULL
          WHERE ${sql.raw(toSnakeCase(fk))} = ${ownerPK}`
    );
  }
}
```

3. **model.ts** -- Hook into destroy():
```typescript
async destroy(): Promise<void> {
  if (!this._persisted) return;

  const ModelClass = this.constructor as ModelStatic;
  const db = getGlobalConnection();
  const { primaryKey } = ModelClass;
  const id = this._data[primaryKey] as number;

  // Run beforeDestroy hooks
  await runHooks(ModelClass.beforeDestroy, this);

  // Process dependent associations (restrict/destroy/nullify)
  await processDependentAssociations(this);

  await (db as any)
    .delete(ModelClass.table)
    .where(eq((ModelClass.table as any)[primaryKey], id));

  this._persisted = false;

  // Run afterDestroy hooks
  await runHooks(ModelClass.afterDestroy, this);
}
```

**Tests** (`src/lib/activerecordjs/dependent.integration.test.ts`):

| Test | Description |
|------|-------------|
| dependent: 'destroy' deletes hasMany children | User with posts, destroy cascades |
| dependent: 'destroy' is recursive | User -> posts -> comments all destroyed |
| dependent: 'destroy' on hasOne | User destroys profile |
| dependent: 'nullify' sets FK to null | User destroy sets posts.userId = null |
| dependent: 'nullify' on hasOne | Profile.userId set to null |
| dependent: 'restrict' prevents destroy | Throws DependentRestrictError |
| dependent: 'restrict' allows destroy when no children | No error when empty |
| no dependent option: no cascading | Default behavior unchanged |
| destroy without dependent runs hooks | beforeDestroy/afterDestroy still fire |
| restrict checked before destroy/nullify | Restrict fails fast before mutations |

**Acceptance Criteria:**
- [ ] `dependent: 'destroy'` recursively destroys children
- [ ] `dependent: 'nullify'` sets FK to NULL on children
- [ ] `dependent: 'restrict'` throws `DependentRestrictError` if children exist
- [ ] Restrict is checked FIRST (fail fast before mutations)
- [ ] Default (no dependent) behavior unchanged
- [ ] Lifecycle hooks still fire in correct order
- [ ] Works for both hasMany and hasOne
- [ ] All existing tests pass

---

### Phase 6: Extended CollectionProxy + Inverse + Scoping

**Goal**: Polish the CollectionProxy API and add inverse association setting.

**Note**: Phase 6 is split into three separate commits:
- **6a**: CollectionProxy methods (`.ids()`, `.empty()`, `.size()`, `.includes()`)
- **6b**: Inverse association setting on `.create()` and `.build()`
- **6c**: Association query scoping (`.where()`)

Each sub-phase should be independently testable and committable.

**Files to modify:**
- `src/lib/activerecordjs/collection-proxy.ts` -- Add `.ids()`, `.empty()`, `.size()`, `.includes(record)`, `.where()`
- `src/lib/activerecordjs/model.ts` -- Inverse association logic in proxy `.create()` and `.build()`
- `src/lib/activerecordjs/habtm-collection-proxy.ts` -- Add `.where()` support if time permits

**Implementation Details:**

#### 6a. Extended CollectionProxy Methods

```typescript
// In CollectionProxy:

/**
 * Return IDs of all related records.
 * Uses a SELECT query for just the PK column -- does NOT load full records.
 */
async ids(): Promise<number[]> {
  const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
  const ModelClass = this.owner.constructor;
  const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

  if (primaryKeyValue == null) return [];

  const RelatedModel = this.config.model();
  const pk = RelatedModel.primaryKey;
  const fkCol = toSnakeCase(foreignKey);
  const pkCol = toSnakeCase(pk);
  const tableName = RelatedModel.tableName;

  // Efficient: only SELECT the PK column, not full records
  const db = getGlobalConnection();
  const results = await db.execute(
    sql`SELECT ${sql.raw(pkCol)} FROM ${sql.raw(tableName)}
        WHERE ${sql.raw(fkCol)} = ${primaryKeyValue}`
  );
  return results.map((r: any) => r[pkCol]);
}

/**
 * Check if collection is empty.
 */
async empty(): Promise<boolean> {
  return (await this.count()) === 0;
}

/**
 * Alias for count().
 */
async size(): Promise<number> {
  return this.count();
}

/**
 * Check if collection includes a specific record (by primary key).
 */
async includes(record: any): Promise<boolean> {
  const RelatedModel = this.config.model();
  const pk = RelatedModel.primaryKey;
  const recordId = record._data?.[pk] ?? record[pk] ?? record;

  const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
  const ModelClass = this.owner.constructor;
  const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

  if (primaryKeyValue == null) return false;

  return RelatedModel.where({ [foreignKey]: primaryKeyValue, [pk]: recordId }).exists();
}
```

#### 6b. Association Query Scoping (Nice-to-Have)

```typescript
/**
 * Return a QueryBuilder scoped to this association.
 * Enables: user.posts.where({ published: true }).all()
 */
where(conditions: Record<string, unknown>): any {
  const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
  const ModelClass = this.owner.constructor;
  const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

  const RelatedModel = this.config.model();
  return RelatedModel.where({ [foreignKey]: primaryKeyValue }).where(conditions);
}
```

This returns a standard QueryBuilder, so `.order()`, `.limit()`, `.first()`, `.count()` all work.

#### 6c. Inverse Association Setting

When creating via a proxy, pre-set the reverse association on the child:

```typescript
// In CollectionProxy.create():
async create(attrs: Record<string, unknown> = {}): Promise<T> {
  // ... existing FK-setting logic ...

  const instance = await RelatedModel.create({
    ...attrs,
    [foreignKey]: primaryKeyValue
  });

  // Set inverse association (if the related model has a matching belongsTo)
  const relatedBelongsTo = RelatedModel.belongsTo ?? {};
  for (const [assocName, config] of Object.entries(relatedBelongsTo) as any) {
    const assocFK = resolveBelongsToForeignKey(assocName, config);
    if (assocFK === foreignKey) {
      // This belongsTo points back to our owner
      instance._associations[assocName] = this.owner;
      break;
    }
  }

  // ... cache invalidation ...
  return instance as T;
}

// Similar logic in build()
```

**Tests** (`src/lib/activerecordjs/collection-extended.integration.test.ts`):

| Test | Description |
|------|-------------|
| ids() returns array of IDs | `user.posts.ids()` returns [1, 2, 3] |
| ids() returns empty for no records | New user returns [] |
| empty() returns true when empty | No posts |
| empty() returns false when not empty | Has posts |
| size() returns count | Alias for count |
| includes(record) returns true for member | Post belongs to user |
| includes(record) returns false for non-member | Post belongs to other user |
| where() scopes by association + conditions | `user.posts.where({ title: 'X' })` |
| where() is chainable | `.where().order().limit()` |
| inverse: create() pre-sets belongsTo | `post.user` cached after `user.posts.create()` |
| inverse: build() pre-sets belongsTo | `post.user` cached after `user.posts.build()` |

**Acceptance Criteria:**
- [ ] `.ids()` returns array of primary keys
- [ ] `.empty()` returns boolean
- [ ] `.size()` returns count
- [ ] `.includes(record)` checks membership by ID
- [ ] `.where()` returns scoped QueryBuilder
- [ ] Inverse association pre-set on `create()` and `build()`
- [ ] All existing tests pass

---

## 7. File Manifest

| File | Action | Phase | Purpose |
|------|--------|-------|---------|
| `src/lib/activerecordjs/types.ts` | MODIFY | 1,3,4 | Add HasOneConfig, HABTMConfig, `through`/`dependent` on HasManyConfig |
| `src/lib/activerecordjs/associations.ts` | MODIFY | 1,2,3,5 | Add hasOne loader, `toSnakeCase` utility (Phase 2), HABTM FK/table inference, dependent processor |
| `src/lib/activerecordjs/model.ts` | MODIFY | 1,2,3,5 | Add static declarations, Proxy handler branches, dependent in destroy() |
| `src/lib/activerecordjs/query-builder.ts` | MODIFY | 2 | Add `whereIn`, `includes` state, eager load in `all()` |
| `src/lib/activerecordjs/collection-proxy.ts` | MODIFY | 4,6 | Add through support, `.ids()`, `.empty()`, `.size()`, `.includes()`, `.where()`, inverse |
| `src/lib/activerecordjs/eager-loader.ts` | CREATE | 2 | Eager loading engine |
| `src/lib/activerecordjs/habtm-collection-proxy.ts` | CREATE | 3 | HABTMCollectionProxy |
| `src/lib/activerecordjs/errors.ts` | MODIFY | 5 | Add DependentRestrictError |
| `src/lib/activerecordjs/index.ts` | MODIFY | 1,2,3,5 | Export new types, classes, errors |
| `src/lib/activerecordjs/fixtures/schema.ts` | MODIFY | 1,3 | Add profilesTable, tagsTable, postsTagsTable |
| `src/lib/activerecordjs/fixtures/models.ts` | MODIFY | 1,3,4 | Add Profile, Tag; add hasOne, HABTM, through declarations |
| `src/lib/activerecordjs/globalSetup.integration.ts` | NO CHANGE | - | Not modified; each test file creates its own tables in `beforeEach` |
| `src/lib/activerecordjs/hasone.integration.test.ts` | CREATE | 1 | hasOne tests |
| `src/lib/activerecordjs/eager-loading.integration.test.ts` | CREATE | 2 | Eager loading tests |
| `src/lib/activerecordjs/habtm.integration.test.ts` | CREATE | 3 | HABTM tests |
| `src/lib/activerecordjs/through.integration.test.ts` | CREATE | 4 | Through association tests |
| `src/lib/activerecordjs/dependent.integration.test.ts` | CREATE | 5 | Dependent option tests |
| `src/lib/activerecordjs/collection-extended.integration.test.ts` | CREATE | 6 | Extended proxy + inverse tests |

---

## 8. Commit Strategy

| Commit | Phase | Message |
|--------|-------|---------|
| 1 | Phase 1 | `AR6: Implement hasOne association with lazy loading` |
| 2 | Phase 2 | `AR6: Add whereIn to QueryBuilder and implement eager loading` |
| 3 | Phase 3 | `AR6: Implement HABTM associations with join table support` |
| 4 | Phase 4 | `AR6: Implement hasMany :through associations` |
| 5 | Phase 5 | `AR6: Add dependent option (destroy/nullify/restrict) to hasMany/hasOne` |
| 6a | Phase 6a | `AR6: Add ids/empty/size/includes to CollectionProxy` |
| 6b | Phase 6b | `AR6: Add inverse association setting on create/build` |
| 6c | Phase 6c | `AR6: Add association query scoping (where) to CollectionProxy` |

Each commit must:
- Pass all tests (`bun test --filter "activerecord"`)
- Pass TypeScript check (`bun run check`)
- Pass lint (`bun run lint`)
- Be independently reviewable

---

## 9. Testing Strategy

### Test Infrastructure Updates

**Chosen pattern: `beforeEach` inline table creation** (consistent with existing `associations.integration.test.ts`).

Each test file manages its own table lifecycle:
- `beforeEach`: DROP IF EXISTS + CREATE TABLE for all tables the test needs, then `setGlobalConnection`
- `afterEach` / `afterAll`: close connection

This is preferred over `globalSetup.integration.ts` because:
1. Each test file is self-contained and independently runnable
2. No shared state or ordering dependencies between test files
3. Table schemas are visible in the test file for readability

**Do NOT** modify `globalSetup.integration.ts` for new tables. Instead, each new test file (hasone, eager-loading, habtm, through, dependent, collection-extended) should create its own required tables in `beforeEach`.

**Test pattern**: Each phase has its own integration test file. All tests use the `createConnection`/`setGlobalConnection` pattern with `beforeEach` table recreation for isolation.

### Query Count Verification (Eager Loading)

For eager loading tests, we need to verify query counts to prove N+1 prevention. Options:
1. **Spy on `db.execute`** -- Count calls before/after
2. **Check `_associations` cache** -- Verify pre-populated after includes
3. **Timing comparison** -- Less reliable

Recommended: Option 2 (check `_associations` cache is pre-populated, meaning no lazy load query fires).

---

## 10. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Raw SQL in HABTM prone to SQL injection | Medium | High | Use Drizzle's `sql` template for parameterized queries. Never interpolate user input. |
| Snake_case/camelCase mismatch in join table columns | High | High | Add `toSnakeCase` utility and test FK inference end-to-end against real DB columns |
| Eager loading `whereIn` with large ID sets | Low | Medium | PostgreSQL handles IN with thousands of values fine; add documentation note for extreme cases |
| Through association circular references | Low | Medium | Through always goes one level deep (owner -> intermediary -> target); document limitation |
| Dependent 'destroy' infinite recursion | Low | High | Only process `dependent` on hasMany/hasOne; belongsTo never triggers cascades; add depth guard if needed |
| CollectionProxy.where() returns QueryBuilder not proxy | Low | Low | Document that scoped queries return QueryBuilder; no proxy methods on result |
| HABTM raw SQL portability | Low | Low | PostgreSQL-only ORM per PRD; no portability concern |

---

## 11. Success Criteria

### Functional Requirements

- [ ] `hasOne` loads single record with FK on related model
- [ ] HABTM loads via join table with `.add()`, `.remove()`, `.ids()`
- [ ] `Model.includes('assoc').all()` batch-loads (separate queries, no JOINs)
- [ ] `dependent: 'destroy'` cascades on owner destroy
- [ ] `dependent: 'nullify'` sets FK to null on owner destroy
- [ ] `dependent: 'restrict'` prevents destroy when children exist
- [ ] `hasMany :through` traverses intermediary associations
- [ ] Inverse association pre-set on proxy `.create()` and `.build()`
- [ ] Extended proxy: `.ids()`, `.empty()`, `.size()`, `.includes()`, `.where()`

### Quality Requirements

- [ ] TypeScript compiles without errors (`bun run check`)
- [ ] All new tests pass
- [ ] No regressions in existing tests
- [ ] Lint passes (`bun run lint`)

### Performance Requirements

- [ ] Eager loading: N records + M association types = M+1 queries (not N*M)
- [ ] HABTM: 2-3 queries per eager-loaded HABTM (join table + target table)

---

## 12. Critical Implementation Notes

### Snake_case Conversion for Raw SQL

HABTM and dependent 'nullify' use raw SQL. Drizzle column names are camelCase in JS but snake_case in the database. A utility is needed.

**File location**: `src/lib/activerecordjs/associations.ts` -- add as an exported utility since it is primarily used for association FK/column name conversion in raw SQL (HABTM queries, dependent nullify). Add in **Phase 2** since eager loading is when `whereIn` and the `'in'` condition type are introduced, and HABTM (Phase 3) depends on it being available.

```typescript
/**
 * Convert camelCase to snake_case for use in raw SQL column references.
 * Drizzle uses camelCase in JS but DB columns are snake_case.
 * e.g., 'postId' -> 'post_id', 'associationForeignKey' -> 'association_foreign_key'
 */
export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}
```

Use this when constructing raw SQL column references: `toSnakeCase('postId')` -> `'post_id'`.

### Proxy Handler Order (After AR6)

The complete Proxy `get` handler priority after AR6:

1. Instance properties and methods (`prop in target || prop.startsWith('_')`)
2. belongsTo associations (returns Promise, caches)
3. hasOne associations (returns Promise, caches)
4. hasMany associations (returns CollectionProxy)
5. hasAndBelongsToMany associations (returns HABTMCollectionProxy)
6. `_data` attributes

### whereIn with Drizzle

Drizzle provides `inArray` from `drizzle-orm`:

```typescript
import { inArray } from 'drizzle-orm';
// Usage in buildQuery:
query = query.where(inArray(column, values));
```

This is the correct Drizzle API for IN clauses. Do NOT use raw SQL for whereIn.

### Empty whereIn Optimization

`inArray` with an empty array can generate invalid SQL. Guard against it:

```typescript
whereIn(column: string, values: unknown[]): QueryBuilder<T, Instance> {
  if (values.length === 0) {
    // Return a builder that will produce no results
    return this.clone({
      whereConditions: [...this.state.whereConditions, { type: 'raw', sql: '1 = 0', params: [] }]
    });
  }
  // ... normal path
}
```

### Eager Loading + CollectionProxy Cache Interaction

When eager loading pre-populates `_associations['posts']` with an array, subsequent access to `user.posts` returns a new CollectionProxy. The CollectionProxy's `load()` method checks `_associations` first, so it finds the eager-loaded data and returns it without a query. This is the desired behavior -- no code changes needed in CollectionProxy for eager loading to work.

### HABTM Join Table Without Drizzle Schema

HABTM join tables may or may not have a Drizzle schema object. The `HABTMCollectionProxy` uses raw SQL via `db.execute(sql`...`)` so it works with any table. If a Drizzle schema IS provided (like `postsTagsTable`), we could use it, but raw SQL is the simpler universal approach.

---

*Plan ready for implementation.*
