# ActiveRecordJS Problems

Blockers and challenges encountered.

---

## Current Blockers

None. AR3 complete, AR4 ready to begin.

---

## Resolved Blockers

### TypeScript Self-Referential Type Error (RESOLVED 2026-01-26)

**Was blocking**: AR3 completion
**Resolution**: Added `ModelStatic` type interface and replaced self-referential `typeof ModelClass` pattern with proper type annotation. Also fixed test files with incorrect type references.
**Files changed**: model.ts, crud.integration.test.ts, model.test.ts, query-builder.integration.test.ts, query-builder.test.ts

---

## Future Considerations

### N+1 Query Prevention (AR5-6)

**Challenge**: Associations will introduce N+1 query risks.

**Approach needed**:
- Eager loading syntax (`User.includes('posts').all()`)
- Automatic N+1 detection in dev mode
- Batch loading strategy

### Async Validators (AR3 Future)

**Challenge**: Current validators are synchronous. Async validators (e.g., uniqueness check) would need different execution model.

**Approach needed**:
- `validateAsync()` method
- Promise-based error collection
- Consider if `isValid()` should become async

### TypeScript Generic Inference (AR5-6)

**Challenge**: Association types need to flow through generics correctly.

Example:
```typescript
class Post extends Model(postsTable) {
  static belongsTo = { user: { model: () => User } };
}
// post.user should be typed as User, not any
```

**Approach needed**: Research TypeScript patterns for self-referential generic inference.

---

## Resolved Blockers

### Class Mixin Pattern Discovery (AR3 Phase 1)

**Was blocking**: AR3 implementation
**Resolution**: Discovered factory-returns-class pattern enables `class User extends Model(table)` syntax while preserving static property inheritance.
**Date resolved**: 2026-01-24

See [learnings.md](./learnings.md) for technical details.
