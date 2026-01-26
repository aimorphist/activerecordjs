# ActiveRecordJS Problems

Blockers and challenges encountered.

---

## No Current Blockers

All AR1-AR3 implementation is unblocked. The remaining AR3 work (Phase 5: types/docs) is straightforward.

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
