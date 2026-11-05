# ActiveRecordJS: Product Requirements Document

> ActiveRecord ergonomics for TypeScript, built on Drizzle.

## Vision

The JavaScript ORM landscape is fragmented and frustrating. Coming from Rails, ActiveRecord was a thing of beauty - it made relational databases a joy to use. Everything else feels like manual SQL scattered through your code.

**ActiveRecordJS** brings Rails-style developer ergonomics to TypeScript:

- Convention over configuration
- Sensible defaults that just work
- Beautiful, minimal API
- Built on Drizzle for rock-solid SQL

We're not chasing TypeScript perfection. Metaprogramming requires `any` in places - that's fine. The goal is **developer happiness**, not type gymnastics.

---

## Core Principles

1. **Convention over configuration** - It just works for 90% of cases
2. **Sensible defaults** - Every table has `id`, timestamps auto-managed
3. **Models are the source of truth** - Associations, validations, hooks all live together
4. **Drizzle is the SQL layer** - We don't replace it, we build on it
5. **TypeScript where helpful, `any` where necessary** - Don't fight metaprogramming
6. **Excellent test coverage is mandatory** - This is fundamental technology; every feature needs thorough unit tests

---

## Conventions

| Convention   | Rule                       | Example                     |
| ------------ | -------------------------- | --------------------------- |
| Table names  | plural snake_case          | `users`, `blog_posts`       |
| Model names  | singular PascalCase        | `User`, `BlogPost`          |
| Primary key  | `id` column, always        | `id: serial().primaryKey()` |
| Foreign keys | `{singular}_id`            | `user_id`, `post_id`        |
| Timestamps   | `created_at`, `updated_at` | Auto-managed on save        |
| Soft delete  | `deleted_at` (optional)    | When present, auto-filtered |
| Join tables  | alphabetical: `posts_tags` | For many-to-many            |

---

## API Design

### Model Definition

```typescript
// schema.ts - Drizzle schema (the SQL layer)
import { pgTable, serial, text, timestamp, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
	id: serial('id').primaryKey(),
	name: text('name'),
	email: text('email').notNull(),
	teamId: integer('team_id').references(() => teams.id),
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

```typescript
// models/user.ts - The ActiveRecord layer
import { Model } from 'activerecordjs';
import { users } from '../schema';
import { z } from 'zod';

export class User extends Model(users) {
	// Associations
	static belongsTo = {
		team: () => Team
	};

	static hasMany = {
		posts: () => Post
	};

	// Validations (Zod schemas)
	static validations = {
		email: z.string().email(),
		name: z.string().min(1).max(100).optional()
	};

	// Lifecycle hooks
	static hooks = {
		beforeSave: [
			(user) => {
				user.email = user.email.toLowerCase();
			}
		],
		afterCreate: [
			(user) => {
				sendWelcomeEmail(user.email);
			}
		]
	};
}
```

### CRUD Operations

```typescript
// Create
const user = await User.create({ name: 'Duke', email: 'duke@example.com' });
// or
const user = User.new({ name: 'Duke', email: 'duke@example.com' });
await user.save();

// Read
const user = await User.find(1); // by id, throws if not found
const user = await User.findBy({ email: 'duke@...' }); // first match
const users = await User.where({ active: true }).all(); // query

// Update
user.name = 'New Name';
await user.save();
// or
await user.update({ name: 'New Name' });
// or
await User.update(1, { name: 'New Name' });

// Delete
await user.destroy();
// or
await User.destroy(1);
```

### Query Interface

```typescript
// Chainable query builder
await User
  .where({ active: true })
  .where('created_at > ?', lastWeek)
  .order('created_at', 'desc')
  .limit(10)
  .offset(20)
  .all();

// Convenience methods
await User.first();
await User.last();
await User.count();
await User.exists({ email: 'duke@...' });
await User.findOrCreate({ email: 'duke@...' }, { name: 'Duke' });

// Raw Drizzle escape hatch
await User.query((table, db) => {
  return db.select().from(table).where(...);
});
```

### Associations

```typescript
// belongsTo
const team = await user.team; // lazy load
await user.team.reload(); // force reload

// hasMany
const posts = await user.posts; // lazy load, returns array
await user.posts.create({ title: '...' }); // create associated
await user.posts.build({ title: '...' }); // build without saving
await user.posts.count();
await user.posts.where({ published: true }).all();

// Eager loading (N+1 prevention)
const users = await User.includes('posts', 'team').all();
users[0].posts; // already loaded, no query
```

### Lifecycle Hooks

Hooks are stacks of lambdas, executed in order:

```typescript
static hooks = {
  // Before hooks - can modify or abort
  beforeValidation: [(instance) => { ... }],
  beforeSave: [(instance) => { ... }],        // runs on create AND update
  beforeCreate: [(instance) => { ... }],
  beforeUpdate: [(instance) => { ... }],
  beforeDestroy: [(instance) => { ... }],

  // After hooks - for side effects
  afterValidation: [(instance) => { ... }],
  afterSave: [(instance) => { ... }],
  afterCreate: [(instance) => { ... }],
  afterUpdate: [(instance) => { ... }],
  afterDestroy: [(instance) => { ... }],

  // Special
  afterFind: [(instance) => { ... }],         // after loading from DB
  afterInitialize: [(instance) => { ... }],   // after .new()
};
```

**Aborting from hooks:**

```typescript
beforeSave: [
	(user) => {
		if (user.email.endsWith('@banned.com')) {
			throw new Model.Abort('Banned email domain');
		}
	}
];
```

### Validations

Zod-based, run automatically before save:

```typescript
static validations = {
  // Field-level with Zod
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().positive().optional(),

  // Custom validators
  $custom: [
    (instance) => {
      if (instance.password !== instance.passwordConfirmation) {
        throw new Model.ValidationError('password', 'does not match confirmation');
      }
    }
  ],
};

// Check validity without saving
user.isValid();           // boolean
user.validate();          // throws ValidationError with details
user.errors;              // after failed validation: { email: ['is invalid'], ... }
```

---

## Milestones

### AR1: Foundation ✅

> Core infrastructure and basic CRUD

- [x] `Model()` base class factory
- [x] Convention detection (table name, primary key, timestamps)
- [x] `find()`, `findBy()`, `all()`, `first()`, `last()`
- [x] `create()`, `save()`, `update()`, `destroy()`
- [x] Auto-managed `updated_at` on save
- [x] Basic error types

**Acceptance:** Can create, read, update, delete records with minimal config.

### AR2: Query Builder ✅

> Chainable query interface

- [x] `where()` with hash and raw SQL support
- [x] `order()`, `limit()`, `offset()`
- [x] `count()`, `exists()`
- [x] `findOrCreate()`, `firstOrCreate()`
- [x] Drizzle escape hatch

**Acceptance:** Can build complex queries with chaining.

### AR3: Validations

> Zod-based validation system

- [ ] Field-level Zod validators
- [ ] Custom validators (`$custom` array)
- [ ] `isValid()`, `validate()`, `errors`
- [ ] Auto-run before save (can disable)
- [ ] `ValidationError` with field details

**Acceptance:** Invalid records can't be saved, errors are accessible.

### AR4: Lifecycle Hooks

> Full hook system

- [ ] All hooks: before/after validation, save, create, update, destroy
- [ ] `afterFind`, `afterInitialize`
- [ ] Hook stacks (multiple callbacks per hook)
- [ ] `Model.Abort` for cancellation
- [ ] Async hook support

**Acceptance:** Can intercept any lifecycle event, hooks run in order.

### AR5: Associations (Core)

> belongsTo and hasMany

- [ ] `belongsTo` declaration and lazy loading
- [ ] `hasMany` declaration and lazy loading
- [ ] Association proxies: `.create()`, `.build()`, `.count()`
- [ ] Foreign key convention inference
- [ ] Manual foreign key override

**Acceptance:** Can traverse and manipulate associations.

### AR6: Associations (Advanced)

> hasOne, through, eager loading

- [ ] `hasOne` association
- [ ] `hasMany through:` for many-to-many
- [ ] `includes()` for eager loading
- [ ] N+1 query prevention

**Acceptance:** Complex associations work, no N+1 queries with includes.

### AR7: Transactions

> ACID guarantees

- [ ] `Model.transaction()` block
- [ ] Automatic rollback on error
- [ ] Nested transaction support (savepoints)
- [ ] Transaction passed through hooks

**Acceptance:** Can wrap multiple operations in transactions.

### AR8: Scopes

> Reusable query fragments

- [ ] Named scopes on model
- [ ] Default scope (e.g., soft delete filtering)
- [ ] Scope chaining
- [ ] `unscoped()` to bypass default scope

```typescript
static scopes = {
  active: (q) => q.where({ active: true }),
  recent: (q) => q.order('created_at', 'desc').limit(10),
};

await User.active.recent.all();
```

**Acceptance:** Can define and chain reusable query fragments.

### AR9: Dirty Tracking (Optional)

> Track attribute changes

- [ ] `instance.changed()` - boolean, any changes?
- [ ] `instance.changes` - { field: [old, new], ... }
- [ ] `instance.fieldChanged` - specific field
- [ ] `instance.fieldWas` - previous value
- [ ] `instance.revertChanges()`
- [ ] Changes available in hooks

**Acceptance:** Can detect and inspect unsaved changes.

---

## Non-Goals (For Now)

- **Migrations** - Use Drizzle's migration system
- **Connection pooling** - Drizzle handles this
- **Multi-database** - Single database assumed
- **Query caching** - Out of scope
- **Polymorphic associations** - Maybe later

---

## Technical Notes

### Drizzle Integration

ActiveRecordJS wraps Drizzle tables, doesn't replace them:

```typescript
// Model wraps a Drizzle table
class User extends Model(users) { ... }

// Internally uses Drizzle for all queries
// db.select().from(users).where(...)
// db.insert(users).values(...)
```

### TypeScript Strategy

- Use `any` for dynamic attribute access on instances
- Keep Drizzle's type inference for schema/queries
- Generated types from Zod validations where possible
- Don't fight the type system for metaprogramming

### Connection Management

```typescript
import { createActiveRecordJS } from 'activerecordjs';
import { drizzle } from 'drizzle-orm/postgres-js';

const db = drizzle(connection);
const { Model } = createActiveRecordJS(db);

// Models automatically use this connection
class User extends Model(users) { ... }
```

---

## Testing Requirements

**This is fundamental technology.** Every piece of functionality requires excellent unit test coverage.

### Test Framework

- **Vitest** for all unit and integration tests
- Fast, native ESM support, compatible with our TypeScript setup

### Testing Standards

1. **Every public API method must have tests** - No exceptions
2. **Edge cases are first-class citizens** - null, undefined, empty arrays, boundary conditions
3. **Tests are documentation** - Reading the tests should explain how the feature works
4. **Isolation** - Unit tests mock the database layer; integration tests use a real test DB
5. **No flaky tests** - Tests must be deterministic and reproducible

### Test Structure

```
tests/
├── unit/
│   ├── model.test.ts           # Model base class
│   ├── query-builder.test.ts   # Query interface
│   ├── validations.test.ts     # Zod integration
│   ├── hooks.test.ts           # Lifecycle hooks
│   └── associations.test.ts    # Relationship handling
├── integration/
│   ├── crud.test.ts            # Full CRUD with real DB
│   ├── transactions.test.ts    # Transaction behavior
│   └── associations.test.ts    # Association queries
└── fixtures/
    ├── schema.ts               # Test Drizzle schema
    └── models.ts               # Test model definitions
```

### Per-Milestone Test Requirements

Each milestone's acceptance criteria includes passing tests:

- **AR1:** CRUD operations, convention detection
- **AR2:** Query builder chaining, all query methods
- **AR3:** Validation pass/fail, error messages, custom validators
- **AR4:** Hook execution order, abort behavior, async hooks
- **AR5-AR6:** Association loading, creation, querying
- **AR7:** Transaction commit/rollback, nesting
- **AR8:** Scope application, chaining, unscoped
- **AR9:** Change detection, revert, hook integration

---

## Open Questions

1. **Instance vs static methods** - Rails has both `User.find` and `user.save`. Same pattern?
2. **Attribute assignment** - Direct `user.name = x` or `user.set({ name: x })`? Both?
3. **Reload behavior** - What happens to unsaved changes on `reload()`?
4. **Association caching** - How long to cache loaded associations?
5. **Soft delete default** - Auto-filter by default or require explicit scope?

---

## Success Metrics

1. **Developer happiness** - Does it feel like ActiveRecord?
2. **Boilerplate reduction** - Less code than raw Drizzle?
3. **Convention adherence** - Do sensible defaults work for 90% of cases?
4. **Escape hatch quality** - Easy to drop to Drizzle when needed?

---

## References

- [Rails ActiveRecord](https://guides.rubyonrails.org/active_record_basics.html)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Zod](https://zod.dev/)
