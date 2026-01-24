// Pure FSM reducer - copied UNCHANGED from orchestrator.ts
// This is the gold - don't touch the logic!

import type { Command } from './commands';
import type { AuthEvent } from './events';
import type { OrchestratorState } from './state';
import { initialState } from './state';

export function reduce(state: OrchestratorState, event: AuthEvent): [OrchestratorState, Command[]] {
	// Ignore stale wallet events
	if ('gen' in event && event.gen !== undefined && event.gen < state.wallet.gen) {
		return [state, []];
	}

	// Handle system events first (apply to all states)
	if (event.type === 'system.focus') {
		const nextState = { ...state, system: { ...state.system, focused: event.focused } };
		if (event.focused) {
			return [nextState, [{ type: 'HYDRATE_SESSION' }]];
		}
		return [nextState, []];
	}

	if (event.type === 'system.visibility') {
		const nextState = { ...state, system: { ...state.system, visibility: event.state } };
		if (event.state === 'visible') {
			return [nextState, [{ type: 'HYDRATE_SESSION' }]];
		}
		return [nextState, []];
	}

	if (event.type === 'system.network') {
		const nextState = { ...state, system: { ...state.system, online: event.online } };
		if (event.online && state.status === 'STALE') {
			return [nextState, [{ type: 'SCHEDULE_RECONNECT', delayMs: 1000 }]];
		}
		return [nextState, []];
	}

	if (event.type === 'system.timer_set') {
		return [
			{
				...state,
				reconnect: {
					...state.reconnect,
					timerId: event.timerId,
					scheduledAt: event.scheduledAt
				}
			},
			[]
		];
	}

	if (event.type === 'system.timer_expired') {
		if (state.reconnect.timerId === event.timerId && state.status === 'STALE') {
			return [
				{
					...state,
					reconnect: { ...state.reconnect, timerId: undefined, scheduledAt: undefined }
				},
				[
					{
						type: 'START_SIWS',
						wallet: {
							pubkey: state.wallet.pubkey!,
							adapterId: state.wallet.adapterId!,
							gen: state.wallet.gen
						}
					}
				]
			];
		}
		return [state, []];
	}

	if (event.type === 'system.timer_cleared') {
		return [
			{
				...state,
				reconnect: {
					...state.reconnect,
					timerId: undefined,
					scheduledAt: undefined
				}
			},
			[]
		];
	}

	switch (state.status) {
		case 'INIT': {
			if (event.type === 'wallet.connected') {
				return [
					{
						...state,
						wallet: {
							connected: true,
							adapterId: event.adapterId,
							pubkey: event.pubkey,
							gen: event.gen
						},
						status: 'WALLET_CONNECTED'
					},
					[]
				];
			}
			if (event.type === 'session.hydrated') {
				if (!event.session.established) {
					return [
						{
							...state,
							hydrating: false,
							status: 'DISCONNECTED'
						},
						[]
					];
				}
				// Has session, wait for wallet
				return [
					{
						...state,
						hydrating: false,
						session: {
							status: 'ESTABLISHED',
							userId: event.session.userId,
							walletPubkey: event.session.walletPubkey,
							expiresAt: event.session.expiresAt
						},
						status: 'DISCONNECTED' // Will transition to READY when wallet connects
					},
					[]
				];
			}
			return [state, []];
		}

		case 'DISCONNECTED': {
			if (event.type === 'wallet.connected') {
				const sessionMatches =
					state.session.status === 'ESTABLISHED' && state.session.walletPubkey === event.pubkey;

				if (sessionMatches) {
					return [
						{
							...state,
							wallet: {
								connected: true,
								adapterId: event.adapterId,
								pubkey: event.pubkey,
								gen: event.gen
							},
							status: 'READY'
						},
						[{ type: 'CLEAR_RECONNECT_TIMER' }]
					];
				}

				return [
					{
						...state,
						wallet: {
							connected: true,
							adapterId: event.adapterId,
							pubkey: event.pubkey,
							gen: event.gen
						},
						status: 'WALLET_CONNECTED'
					},
					[]
				];
			}

			if (event.type === 'intent.logout') {
				return [
					{
						...initialState,
						hydrating: false
					},
					[{ type: 'LOGOUT_SESSION', reason: event.reason, hard: event.hard }]
				];
			}

			break;
		}

		case 'WALLET_CONNECTED': {
			if (event.type === 'intent.authenticate') {
				return [
					{
						...state,
						status: 'AUTHENTICATING'
					},
					[
						{
							type: 'START_SIWS',
							wallet: {
								pubkey: state.wallet.pubkey!,
								adapterId: state.wallet.adapterId!,
								gen: state.wallet.gen
							}
						}
					]
				];
			}

			if (event.type === 'session.hydrated') {
				if (event.session.established && event.session.walletPubkey === state.wallet.pubkey) {
					return [
						{
							...state,
							session: {
								status: 'ESTABLISHED',
								userId: event.session.userId,
								walletPubkey: event.session.walletPubkey,
								expiresAt: event.session.expiresAt
							},
							status: 'READY'
						},
						[{ type: 'CLEAR_RECONNECT_TIMER' }]
					];
				}

				// Mismatch or no session - need auth
				return [
					{
						...state,
						status: 'AUTHENTICATING'
					},
					[
						{
							type: 'START_SIWS',
							wallet: {
								pubkey: state.wallet.pubkey!,
								adapterId: state.wallet.adapterId!,
								gen: state.wallet.gen
							}
						}
					]
				];
			}

			if (event.type === 'wallet.disconnected') {
				return [
					{
						...state,
						wallet: { connected: false, gen: state.wallet.gen },
						status: 'DISCONNECTED'
					},
					[{ type: 'CLEAR_RECONNECT_TIMER' }]
				];
			}

			if (event.type === 'wallet.account_changed') {
				return [
					{
						...state,
						wallet: { ...state.wallet, pubkey: event.pubkey, gen: event.gen },
						status: 'AUTHENTICATING'
					},
					[
						{
							type: 'START_SIWS',
							wallet: {
								pubkey: event.pubkey,
								adapterId: event.adapterId,
								gen: event.gen
							}
						}
					]
				];
			}

			break;
		}

		case 'AUTHENTICATING': {
			if (event.type === 'session.established') {
				if (event.walletPubkey === state.wallet.pubkey) {
					return [
						{
							...state,
							session: {
								status: 'ESTABLISHED',
								userId: event.userId,
								walletPubkey: event.walletPubkey,
								expiresAt: event.expiresAt,
								assertedAt: Date.now(),
								boundGen: state.wallet.gen
							},
							reconnect: { attempts: 0 },
							status: 'READY'
						},
						[{ type: 'CLEAR_RECONNECT_TIMER' }]
					];
				}
			}

			if (event.type === 'session.invalidated') {
				if (event.hard) {
					return [
						{
							...state,
							session: { ...state.session, status: 'STALE' },
							reconnect: { attempts: 0 },
							status: 'ERROR'
						},
						[{ type: 'CLEAR_RECONNECT_TIMER' }]
					];
				}
				const attempts = (state.reconnect.attempts ?? 0) + 1;
				// Cap at 1 attempt, then give up and go to DISCONNECTED
				if (attempts >= 1) {
					return [
						{
							...state,
							session: { status: 'NONE' },
							reconnect: { attempts: 0 },
							status: 'DISCONNECTED'
						},
						[{ type: 'CLEAR_RECONNECT_TIMER' }]
					];
				}
				return [
					{
						...state,
						session: { ...state.session, status: 'STALE' },
						reconnect: { ...state.reconnect, attempts },
						status: 'STALE'
					},
					[{ type: 'SCHEDULE_RECONNECT', delayMs: 2000 }]
				];
			}

			if (event.type === 'wallet.account_changed') {
				return [
					{
						...state,
						wallet: { ...state.wallet, pubkey: event.pubkey, gen: event.gen }
					},
					[
						{
							type: 'START_SIWS',
							wallet: {
								pubkey: event.pubkey,
								adapterId: event.adapterId,
								gen: event.gen
							}
						}
					]
				];
			}

			if (event.type === 'wallet.disconnected') {
				return [
					{
						...state,
						wallet: { connected: false, gen: state.wallet.gen, lastDisconnectAt: Date.now() },
						status: 'DISCONNECTED'
					},
					[{ type: 'CLEAR_RECONNECT_TIMER' }]
				];
			}

			break;
		}

		case 'READY': {
			if (event.type === 'wallet.account_changed') {
				return [
					{
						...state,
						wallet: { ...state.wallet, pubkey: event.pubkey, gen: event.gen },
						status: 'AUTHENTICATING'
					},
					[
						{
							type: 'START_SIWS',
							wallet: {
								pubkey: event.pubkey,
								adapterId: event.adapterId,
								gen: event.gen
							}
						}
					]
				];
			}

			if (event.type === 'wallet.disconnected') {
				const shouldLogout = event.reason === 'user' || event.reason === 'appInitiated';
				if (shouldLogout) {
					return [
						{
							...state,
							wallet: { connected: false, gen: state.wallet.gen, lastDisconnectAt: Date.now() },
							session: { status: 'NONE' },
							status: 'DISCONNECTED'
						},
						[{ type: 'LOGOUT_SESSION', reason: event.reason }, { type: 'CLEAR_RECONNECT_TIMER' }]
					];
				}

				// Natural disconnect - preserve session
				return [
					{
						...state,
						wallet: { connected: false, gen: state.wallet.gen, lastDisconnectAt: Date.now() },
						status: 'DISCONNECTED'
					},
					[]
				];
			}

			if (event.type === 'session.invalidated') {
				if (event.hard) {
					return [
						{
							...state,
							session: { ...state.session, status: 'STALE' },
							reconnect: { attempts: 0 },
							status: 'ERROR'
						},
						[{ type: 'CLEAR_RECONNECT_TIMER' }]
					];
				}
				const attempts = (state.reconnect.attempts ?? 0) + 1;
				// Cap at 1 attempt, then give up and go to DISCONNECTED
				if (attempts >= 1) {
					return [
						{
							...state,
							session: { status: 'NONE' },
							reconnect: { attempts: 0 },
							status: 'DISCONNECTED'
						},
						[{ type: 'CLEAR_RECONNECT_TIMER' }]
					];
				}
				return [
					{
						...state,
						session: { ...state.session, status: 'STALE' },
						reconnect: { ...state.reconnect, attempts },
						status: 'STALE'
					},
					[{ type: 'SCHEDULE_RECONNECT', delayMs: 2000 }]
				];
			}

			if (event.type === 'session.refreshed') {
				return [
					{
						...state,
						session: { ...state.session, expiresAt: event.expiresAt }
					},
					[]
				];
			}

			if (event.type === 'intent.logout') {
				return [
					{
						...state,
						wallet: { connected: false, gen: state.wallet.gen },
						session: { status: 'NONE' },
						status: 'DISCONNECTED'
					},
					[
						{ type: 'LOGOUT_SESSION', reason: event.reason, hard: event.hard },
						{ type: 'DISCONNECT_WALLET', gen: state.wallet.gen }
					]
				];
			}

			break;
		}

		case 'STALE': {
			if (event.type === 'intent.reconnect' && state.system.online) {
				return [
					{
						...state,
						status: 'AUTHENTICATING'
					},
					[
						{
							type: 'START_SIWS',
							wallet: {
								pubkey: state.wallet.pubkey!,
								adapterId: state.wallet.adapterId!,
								gen: state.wallet.gen
							}
						},
						{ type: 'CLEAR_RECONNECT_TIMER' }
					]
				];
			}

			if (event.type === 'session.established') {
				return [
					{
						...state,
						session: {
							status: 'ESTABLISHED',
							userId: event.userId,
							walletPubkey: event.walletPubkey,
							expiresAt: event.expiresAt,
							assertedAt: Date.now(),
							boundGen: state.wallet.gen
						},
						status: 'READY'
					},
					[{ type: 'CLEAR_RECONNECT_TIMER' }]
				];
			}

			if (event.type === 'wallet.disconnected') {
				return [
					{
						...state,
						wallet: { connected: false, gen: state.wallet.gen, lastDisconnectAt: Date.now() },
						status: 'DISCONNECTED'
					},
					[{ type: 'CLEAR_RECONNECT_TIMER' }]
				];
			}

			break;
		}

		case 'ERROR': {
			if (event.type === 'intent.logout') {
				return [
					{
						...initialState,
						hydrating: false
					},
					[
						{ type: 'LOGOUT_SESSION', reason: event.reason, hard: event.hard },
						{ type: 'DISCONNECT_WALLET' }
					]
				];
			}
			break;
		}
	}

	// Unhandled event
	return [state, []];
}
