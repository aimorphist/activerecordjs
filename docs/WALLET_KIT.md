# Solana Wallet Kit

Production-ready Solana wallet connection library with Sign-In With Solana (SIWS) authentication.

## Features

- **Framework-Agnostic Core**: Pure TypeScript FSM that works with any framework
- **Svelte 5 Integration**: Built-in reactive state management with Svelte runes
- **SIWS Authentication**: Secure server-side wallet authentication
- **Mobile-First**: Deep linking, Wallet Standard support, in-app browser detection
- **Comprehensive Edge Case Handling**: Account switching, session mismatches, network failures
- **Type-Safe**: Full TypeScript support with strict typing

## Supported Wallets

### Explicit Adapters

- Phantom
- Solflare
- Backpack

### Wallet Standard

Auto-detects any Wallet Standard compliant wallet including:

- MetaMask
- Glow
- Ultimate
- Any future Solana wallets implementing the standard

## Installation

```bash
npm install @startdotfun/solana-wallet-kit
# or
bun add @startdotfun/solana-wallet-kit
# or
yarn add @startdotfun/solana-wallet-kit
```

## Quick Start (Svelte 5)

### 1. Create Auth Instance

```typescript
// src/lib/auth.svelte.ts
import { createAuth } from '@startdotfun/solana-wallet-kit/svelte';

export const auth = createAuth({
  domain: 'your-app.com',
  uri: 'https://your-app.com',
  session: {
    paths: {
      session: '/api/wallet/session',
      nonce: '/api/wallet/nonce',
      establish: '/api/wallet/establish',
      logout: '/api/wallet/logout'
    }
  }
});
```

### 2. Use in Components

```svelte
<script lang="ts">
	import { auth } from '$lib/auth.svelte';
	import { connectWallet, authenticate, logout } from '@startdotfun/solana-wallet-kit/svelte';

	// Reactive state
	const { status, walletPubkey, userId, isReady, walletConnected } = auth;

	async function handleConnect() {
		await connectWallet('phantom', auth.walletBridge);
		await authenticate(auth.machine);
	}

	async function handleLogout() {
		await logout(auth.machine, auth.walletBridge, true);
	}
</script>

{#if isReady}
	<div>
		<p>Connected: {walletPubkey}</p>
		<p>User ID: {userId}</p>
		<button onclick={handleLogout}>Disconnect</button>
	</div>
{:else if walletConnected}
	<button onclick={() => authenticate(auth.machine)}>Sign In</button>
{:else}
	<button onclick={handleConnect}>Connect Wallet</button>
{/if}
```

## Server-Side Setup

### 1. Database Schema

Add the wallet authentication tables to your database:

```typescript
// See src/lib/server/db/schema.example.ts for full schema
export const walletUsers = pgTable('wallet_users', {
  id: text('id').primaryKey(),
  walletAddress: text('wallet_address').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const walletSessions = pgTable('wallet_sessions', {
  id: text('id').primaryKey(),
  secretHash: text('secret_hash').notNull(),
  userId: text('user_id').references(() => walletUsers.id).notNull(),
  walletAddress: text('wallet_address').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
});

export const authNonces = pgTable('auth_nonces', {
  nonce: text('nonce').primaryKey(),
  walletAddress: text('wallet_address').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
});
```

### 2. API Endpoints

See example endpoint implementations in `src/routes/api/wallet/*/+server.example.ts`:

- `POST /api/wallet/nonce` - Generate authentication nonce
- `POST /api/wallet/establish` - Verify signature and create session
- `POST /api/wallet/logout` - Invalidate session
- `GET /api/wallet/session` - Check session status

### 3. Environment Variables

```bash
# Required
ALLOWED_ORIGINS=https://your-app.com,.your-app.com,http://localhost:5173
NODE_ENV=production

# Optional
PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

## Architecture

```
┌─────────────────────────────────────────────┐
│           Components (UI)                   │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│      Helper Functions (connectWallet,       │
│      authenticate, logout)                  │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│    Auth Store (Svelte 5 $state runes)       │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│   State Machine (Pure FSM Reducer)          │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│  Commands (Side Effects) → Adapters         │
│  (Wallet, Session, System)                  │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│  External Systems (Wallets, Server API,     │
│  Browser)                                   │
└─────────────────────────────────────────────┘
```

## State Flow

```
INIT → DISCONNECTED ⟷ WALLET_CONNECTED ⟷ AUTHENTICATING → READY
           ↓                    ↓                 ↓            ↓
         ERROR                STALE ← ← ← ← ← ← ← ← ← ← ← ← ←┘
```

## Advanced Usage

### Framework-Agnostic Core

The core state machine can be used with any framework:

```typescript
import { reduce, initialState, handleCommand } from '@startdotfun/solana-wallet-kit/core';

// Use the pure FSM reducer in your own framework
const [nextState, commands] = reduce(currentState, event);
```

### Custom Session Manager

```typescript
import { createSessionManager } from '@startdotfun/solana-wallet-kit/adapters';

const sessionManager = createSessionManager({
  baseUrl: 'https://api.your-app.com',
  paths: {
    session: '/custom/session/path',
    nonce: '/custom/nonce/path',
    establish: '/custom/establish/path',
    logout: '/custom/logout/path'
  }
});
```

### Mobile Deep Linking

```typescript
import { openWalletApp, isInsideWalletBrowser } from '@startdotfun/solana-wallet-kit/adapters';

// Check if inside wallet browser
const { isInside, walletId } = isInsideWalletBrowser();

// Open wallet app via deep link
if (isMobileDevice()) {
  openWalletApp('phantom');
}
```

## Security

### Origin Validation

All auth endpoints validate the request origin against an allowlist:

```typescript
import { validateOrigin } from '@startdotfun/solana-wallet-kit/server';

const originError = validateOrigin(origin, referer, host);
if (originError) {
  return json({ error: originError.error }, { status: originError.status });
}
```

### Nonce Security

- One-time use only
- 5-minute expiration
- Wallet address binding
- Server-side generation with cryptographic randomness

### Session Security

- Secret hashing (SHA-256)
- HttpOnly cookies
- Secure transmission (HTTPS in production)
- SameSite protection (CSRF prevention)

## Testing

Example test implementations are available in the source code:

- `src/lib/wallet/core/reducer.test.ts` - FSM state transitions
- `src/lib/wallet/core/commands.test.ts` - Command handlers
- `src/lib/wallet/core/siws.test.ts` - SIWS verification

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or PR.

## Support

For issues and questions:

- GitHub Issues: https://github.com/your-org/solana-wallet-kit/issues
- Documentation: https://docs.your-app.com/wallet-kit
