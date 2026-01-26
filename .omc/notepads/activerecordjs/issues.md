# ActiveRecordJS Issues

Known issues and workarounds.

---

## TypeScript Self-Referential Type Error (AR3 BLOCKER)

**Status**: Open (BLOCKING AR3 completion)
**Severity**: HIGH
**Date**: 2026-01-26
**File**: `src/lib/activerecordjs/model.ts`
**Lines**: 125, 173, 220, 242

**Issue**: TypeScript error: `'ModelClass' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.`

**Code Pattern**:
```typescript
const ModelClass = this.constructor as typeof ModelClass;  // Self-referential!
```

**Root Cause**: The variable `ModelClass` cannot be typed as `typeof ModelClass` because that creates a circular reference during type inference.

**Fix Options**:
1. **Type assertion approach**: Use a base class type instead of self-reference
   ```typescript
   const ModelClass = this.constructor as typeof BaseModel;
   ```
2. **Generic constraint approach**: Pass model class as generic parameter
3. **Interface approach**: Define `ModelStatic` interface and cast to that

**Workaround**: Tests pass despite TS errors because Bun runtime ignores type errors.

---

## Fixture File Syntax Error

**Status**: Open
**Severity**: MEDIUM
**Date**: 2026-01-26
**File**: `src/lib/activerecordjs/fixtures/models.ts`
**Line**: 1

**Issue**: Line 1 contains `\import` instead of `import` (errant backslash character).

**Fix**: Remove the backslash.

---

## Console REPL Variable Persistence

**Status**: Open
**Severity**: Low (development tooling)
**Date**: 2026-01-24

**Issue**: The Bagpipe console (`scripts/console.ts`) uses `new Function()` for eval, but variable declarations (`const User = ...`) don't persist between commands.

**Workaround**: Test models in actual test files instead of console.

**Root cause**: `new Function()` creates a new scope; variables declared inside don't escape.

**Potential fix**: Use `vm.createContext()` with persistent context, or modify eval to use `with()` statement properly.

---

## Integration Tests Require Sequential Execution

**Status**: Workaround in place
**Severity**: Medium (test performance)
**Date**: 2026-01-24

**Issue**: Integration tests share database and conflict when run in parallel.

**Current workaround**: `fileParallelism: false` in `vitest.integration.config.ts`

**Proper fix**: Implement transaction-based test isolation:
```typescript
// In setup.integration.ts
export async function beginTestTransaction() {
  // Start transaction, store tx-scoped db
  // setGlobalConnection(txDb)
}

export async function rollbackTestTransaction() {
  // Rollback, restore original connection
}
```

---

## TypeScript Strict Mode Compatibility

**Status**: Workaround in place
**Severity**: Low
**Date**: 2026-01-24

**Issue**: Dynamic attribute access via Proxy requires `[key: string]: any` index signature, which loosens type safety.

**Workaround**: Accept the tradeoff for ergonomic API. TypeScript can't fully represent Proxy-based dynamic access.

**Potential improvement**: Generate typed model classes from Drizzle schema at build time.

---

## Pre-existing Lint/Type Errors in Other Files

**Status**: Acknowledged
**Severity**: Low (not ActiveRecordJS-related)
**Date**: 2026-01-24

**Issue**: `bun run check` shows errors in files outside `src/lib/activerecordjs/`.

**Examples**:
- `src/lib/server/services/bags.ts:1:24` - BagsClaimablePosition not exported

**Workaround**: Focus on ActiveRecordJS files; ignore unrelated errors for now.

**Fix**: Address other codebase issues separately.
