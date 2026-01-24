// System bridge - centralized DOM event listeners with SSR guards
// Factory function, dispatches events directly (no EventBus coupling)

import type { AuthEvent } from '../core/events';

export function createSystemBridge(dispatch: (event: AuthEvent) => void) {
	const cleanupFns: Array<() => void> = [];

	function init() {
		if (typeof document === 'undefined') return; // SSR guard

		// Visibility API
		const handleVisibilityChange = () => {
			dispatch({
				type: 'system.visibility',
				state: document.hidden ? 'hidden' : 'visible'
			});
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);
		cleanupFns.push(() => document.removeEventListener('visibilitychange', handleVisibilityChange));

		// Focus tracking
		const handleFocus = () => {
			dispatch({ type: 'system.focus', focused: true });
		};
		const handleBlur = () => {
			dispatch({ type: 'system.focus', focused: false });
		};
		window.addEventListener('focus', handleFocus);
		window.addEventListener('blur', handleBlur);
		cleanupFns.push(() => window.removeEventListener('focus', handleFocus));
		cleanupFns.push(() => window.removeEventListener('blur', handleBlur));

		// Network status
		const handleOnline = () => {
			dispatch({ type: 'system.network', online: true });
		};
		const handleOffline = () => {
			dispatch({ type: 'system.network', online: false });
		};
		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);
		cleanupFns.push(() => window.removeEventListener('online', handleOnline));
		cleanupFns.push(() => window.removeEventListener('offline', handleOffline));
	}

	function dispose() {
		cleanupFns.forEach((fn) => fn());
		cleanupFns.length = 0;
	}

	return {
		init,
		dispose
	};
}

export type SystemBridge = ReturnType<typeof createSystemBridge>;
