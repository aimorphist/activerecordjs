# ActiveRecordJS Issues

Known issues and workarounds.

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

**Issue**: `bun run check` and `bun run lint` show errors in files outside `src/lib/activerecordjs/`.

**Workaround**: ActiveRecordJS files are clean; ignore unrelated errors for now.

**Fix**: Address other codebase issues separately.
