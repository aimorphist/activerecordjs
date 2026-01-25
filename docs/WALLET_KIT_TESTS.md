# Testing Guide

## Test Files to Create

The following test files should be copied from the frontpage app and adapted:

### Core Tests

1. **`src/lib/wallet/core/reducer.test.ts`**
   - Copy from: `apps/frontpage/src/lib/auth/domain/reducer.test.ts`
   - 25+ test cases covering all FSM state transitions
   - Update imports to use `../core/*`

2. **`src/lib/wallet/core/commands.test.ts`**
   - Copy from: `apps/frontpage/src/lib/auth/domain/commands.test.ts`
   - Mock-based command handler tests
   - Update imports to use `../core/*`

3. **`src/lib/wallet/core/siws.test.ts`**
   - Copy from: `apps/frontpage/src/lib/auth/siws.test.ts`
   - SIWS message building and verification tests
   - Update imports

### Server Tests

4. **`src/lib/wallet/server/session.test.ts`**
   - Test session creation, validation, and deletion
   - Test secret hashing and cookie parsing
   - Mock SessionStore implementation

5. **`src/lib/wallet/server/origin.test.ts`**
   - Copy from: `apps/frontpage/src/lib/auth/origin.test.ts`
   - Origin validation tests
   - Wildcard subdomain matching tests

### Integration Tests

6. **`src/lib/wallet/integration.test.ts`**
   - Copy from: `apps/frontpage/src/lib/auth/integration.test.ts`
   - End-to-end flow scenarios:
     - Cold start (no session)
     - Session reuse on reconnect
     - Session/wallet mismatch
     - Hard errors (401/403)
     - Soft errors (retries)
     - Account switching
     - Network offline/online

## Test Setup

### Install Test Dependencies

```bash
bun add -D vitest @vitest/ui @testing-library/svelte @testing-library/jest-dom
```

### Vitest Configuration

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte({ hot: !process.env.VITEST })],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts']
  }
});
```

### Test Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage"
  }
}
```

## Running Tests

```bash
# Run all tests
bun test

# Run with UI
bun test:ui

# Run specific test file
bun test reducer.test.ts

# Run with coverage
bun test:coverage
```

## Test Helpers

Create `src/test/helpers.ts`:

```typescript
import type { OrchestratorState } from '../lib/wallet/core/state';
import { initialState } from '../lib/wallet/core/state';

export function createMockState(overrides?: Partial<OrchestratorState>): OrchestratorState {
  return {
    ...initialState,
    ...overrides
  };
}

export function createMockAdapter() {
  return {
    name: 'Test Wallet',
    connect: vi.fn(),
    disconnect: vi.fn(),
    signMessage: vi.fn(),
    publicKey: { toBase58: () => 'test-pubkey' },
    connected: true
  };
}
```

## Coverage Goals

- Core (reducer, commands): 100%
- Adapters: 80%+
- Server utilities: 90%+
- Overall: 85%+
