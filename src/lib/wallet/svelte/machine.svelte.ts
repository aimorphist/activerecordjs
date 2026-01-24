// Svelte 5 runes-based auth state machine

import type { Command, CommandDeps } from '../core/commands';
import { handleCommand } from '../core/commands';
import type { AuthEvent } from '../core/events';
import { reduce } from '../core/reducer';
import type { OrchestratorState } from '../core/state';
import { initialState } from '../core/state';

export function createAuthMachine(deps: CommandDeps) {
	// Use Svelte 5 $state rune
	const state = $state<OrchestratorState>(structuredClone(initialState));

	// Derived computed values using $derived
	const isReady = $derived(state.status === 'READY');
	const walletPubkey = $derived(state.wallet.pubkey);
	const userId = $derived(state.session.userId);
	const isAuthenticating = $derived(state.status === 'AUTHENTICATING');
	const walletConnected = $derived(state.wallet.connected);
	const status = $derived(state.status);
	const isHydrating = $derived(state.hydrating);
	const sessionStatus = $derived(state.session.status);

	// Command queue (prevents reentrancy)
	const queue: Command[] = [];
	let flushing = false;

	// Timer tracking (separate from command queue)
	let reconnectTimerId: number | undefined;

	function dispatch(event: AuthEvent) {
		const [next, cmds] = reduce(state, event);

		// Mutate $state directly for Svelte reactivity
		Object.assign(state, next);

		// Handle timer commands immediately (not async)
		const asyncCmds = cmds.filter((cmd) => {
			if (cmd.type === 'SCHEDULE_RECONNECT') {
				scheduleReconnect(cmd.delayMs);
				return false;
			}
			if (cmd.type === 'CLEAR_RECONNECT_TIMER') {
				clearReconnectTimer();
				return false;
			}
			return true;
		});

		if (asyncCmds.length > 0) {
			queue.push(...asyncCmds);
			flush();
		}
	}

	function scheduleReconnect(delayMs: number) {
		if (reconnectTimerId) {
			console.debug('[machine] Reconnect already scheduled, skipping');
			return;
		}

		reconnectTimerId = setTimeout(() => {
			dispatch({ type: 'intent.reconnect', delayMs });
			reconnectTimerId = undefined;
			dispatch({ type: 'system.timer_cleared' });
		}, delayMs) as unknown as number;

		dispatch({
			type: 'system.timer_set',
			timerId: reconnectTimerId,
			scheduledAt: Date.now()
		});

		console.debug('[machine] Scheduled reconnect in', delayMs, 'ms, timerId:', reconnectTimerId);
	}

	function clearReconnectTimer() {
		if (reconnectTimerId) {
			clearTimeout(reconnectTimerId as unknown as NodeJS.Timeout);
			console.debug('[machine] Cleared reconnect timer:', reconnectTimerId);
			reconnectTimerId = undefined;
		}
	}

	async function flush() {
		if (flushing) return;
		flushing = true;

		await Promise.resolve(); // Microtask boundary

		while (queue.length > 0) {
			const cmd = queue.shift()!;
			try {
				const events = await handleCommand(cmd, deps);
				for (const event of events) {
					dispatch(event);
				}
			} catch (err) {
				console.error('[machine] Command failed:', cmd, err);
			}
		}

		flushing = false;
	}

	function dispose() {
		clearReconnectTimer();
		queue.length = 0;
	}

	return {
		// $state proxy (reactive in Svelte components)
		get state() {
			return state;
		},

		// Derived values (reactive)
		get isReady() {
			return isReady;
		},
		get walletPubkey() {
			return walletPubkey;
		},
		get userId() {
			return userId;
		},
		get isAuthenticating() {
			return isAuthenticating;
		},
		get walletConnected() {
			return walletConnected;
		},
		get status() {
			return status;
		},
		get isHydrating() {
			return isHydrating;
		},
		get sessionStatus() {
			return sessionStatus;
		},

		// Actions
		dispatch,
		getState: () => ({
			status: state.status,
			wallet: state.wallet,
			session: state.session,
			hydrating: state.hydrating
		}),
		dispose
	};
}

export type AuthMachine = ReturnType<typeof createAuthMachine>;
