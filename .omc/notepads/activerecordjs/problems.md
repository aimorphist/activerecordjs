# ActiveRecordJS Problems

Blockers and challenges encountered.

---

## Current Blockers

### TypeScript Self-Referential Type Error

**Status**: BLOCKING AR3 completion
**Impact**: Cannot mark AR3 complete; blocks AR4-AR9 progression

The pattern `const ModelClass = this.constructor as typeof ModelClass` creates a circular type reference. This is used in 4 methods that need access to static properties from instance context.

**Fix Required**: Refactor to use a proper type annotation. Options documented in [issues.md](./issues.md).

**Estimated Effort**: Small (2-3 line changes per occurrence)

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
