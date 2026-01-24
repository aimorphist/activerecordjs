// Pure state type definitions - no framework dependencies

export type OrchestratorStatus =
	| 'INIT'
	| 'DISCONNECTED'
	| 'WALLET_CONNECTED'
	| 'AUTHENTICATING'
	| 'READY'
	| 'STALE'
	| 'ERROR';

export type WalletState = {
	connected: boolean;
	adapterId?: string;
	pubkey?: string;
	gen: number;
	lastDisconnectAt?: number;
	lastError?: string;
};

export type SessionState = {
	status: 'NONE' | 'ESTABLISHED' | 'STALE' | 'INVALID';
	userId?: string;
	walletPubkey?: string;
	expiresAt?: string;
	assertedAt?: number;
	boundGen?: number;
};

export type SystemState = {
	visibility: 'visible' | 'hidden';
	focused: boolean;
	online: boolean;
};

export type ReconnectState = {
	timerId?: number;
	scheduledAt?: number;
	backoffMs?: number;
	attempts?: number;
};

export type OrchestratorState = {
	status: OrchestratorStatus;
	hydrating: boolean;
	wallet: WalletState;
	session: SessionState;
	system: SystemState;
	reconnect: ReconnectState;
	lastError?: string;
};

export const initialState: OrchestratorState = {
	status: 'INIT',
	hydrating: true,
	wallet: { connected: false, gen: 0 },
	session: { status: 'NONE' },
	system: { visibility: 'visible', focused: true, online: true },
	reconnect: {}
};
