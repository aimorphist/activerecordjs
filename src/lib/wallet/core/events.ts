// Pure TypeScript event types - no runtime validation
// Zod validation happens at boundaries (wallet provider, API) only

// ============================================================================
// WALLET EVENTS
// ============================================================================

export type WalletConnected = {
	type: 'wallet.connected';
	adapterId: string;
	pubkey: string;
	gen: number;
};

export type WalletDisconnected = {
	type: 'wallet.disconnected';
	adapterId: string;
	reason?:
		| 'user'
		| 'appInitiated'
		| 'accountChange'
		| 'providerReplaced'
		| 'networkChange'
		| 'natural'
		| 'unknown';
	gen: number;
};

export type WalletAccountChanged = {
	type: 'wallet.account_changed';
	adapterId: string;
	pubkey: string;
	gen: number;
};

export type WalletError = {
	type: 'wallet.error';
	adapterId?: string;
	message: string;
	code?: string;
	gen?: number;
};

// ============================================================================
// SESSION EVENTS
// ============================================================================

export type SessionHydrated = {
	type: 'session.hydrated';
	session: {
		established: boolean;
		userId?: string;
		walletPubkey?: string;
		expiresAt?: string;
	};
};

export type SessionEstablished = {
	type: 'session.established';
	userId: string;
	walletPubkey: string;
	expiresAt?: string;
};

export type SessionInvalidated = {
	type: 'session.invalidated';
	reason?: string;
	hard?: boolean;
};

export type SessionRefreshed = {
	type: 'session.refreshed';
	expiresAt?: string;
};

// ============================================================================
// SYSTEM EVENTS
// ============================================================================

export type SystemVisibility = {
	type: 'system.visibility';
	state: 'visible' | 'hidden';
};

export type SystemFocus = {
	type: 'system.focus';
	focused: boolean;
};

export type SystemNetwork = {
	type: 'system.network';
	online: boolean;
};

export type SystemTimerSet = {
	type: 'system.timer_set';
	timerId: number;
	scheduledAt?: number;
};

export type SystemTimerCleared = {
	type: 'system.timer_cleared';
};

export type SystemTimerExpired = {
	type: 'system.timer_expired';
	timerId: number;
};

// ============================================================================
// USER INTENT EVENTS
// ============================================================================

export type IntentAuthenticate = {
	type: 'intent.authenticate';
	reason?: string;
};

export type IntentLogout = {
	type: 'intent.logout';
	reason?: string;
	hard?: boolean;
};

export type IntentReconnect = {
	type: 'intent.reconnect';
	delayMs?: number;
};

// ============================================================================
// UNIFIED EVENT UNION
// ============================================================================

export type AuthEvent =
	| WalletConnected
	| WalletDisconnected
	| WalletAccountChanged
	| WalletError
	| SessionHydrated
	| SessionEstablished
	| SessionInvalidated
	| SessionRefreshed
	| SystemVisibility
	| SystemFocus
	| SystemNetwork
	| SystemTimerSet
	| SystemTimerCleared
	| SystemTimerExpired
	| IntentAuthenticate
	| IntentLogout
	| IntentReconnect;

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isWalletEvent(
	event: AuthEvent
): event is WalletConnected | WalletDisconnected | WalletAccountChanged | WalletError {
	return event.type.startsWith('wallet.');
}

export function isSessionEvent(
	event: AuthEvent
): event is SessionHydrated | SessionEstablished | SessionInvalidated | SessionRefreshed {
	return event.type.startsWith('session.');
}

export function isSystemEvent(
	event: AuthEvent
): event is SystemVisibility | SystemFocus | SystemNetwork | SystemTimerSet | SystemTimerCleared | SystemTimerExpired {
	return event.type.startsWith('system.');
}

export function isIntentEvent(
	event: AuthEvent
): event is IntentAuthenticate | IntentLogout | IntentReconnect {
	return event.type.startsWith('intent.');
}

// ============================================================================
// DISCONNECT REASON TYPE
// ============================================================================

export type DisconnectReason = WalletDisconnected['reason'];
