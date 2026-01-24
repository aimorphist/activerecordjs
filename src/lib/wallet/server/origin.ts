/**
 * Origin validation utility for auth endpoints with wildcard subdomain support
 * Story 3.2: AC9 - Enforce strict origin allowlist on non-GET auth endpoints
 * Enhanced: Supports wildcard subdomains (e.g., ".ngrok-free.app" matches "abc.ngrok-free.app")
 */

const isDev = () => process.env.NODE_ENV !== 'production';
const isNonProd = () => process.env.NODE_ENV !== 'production';

type AllowedEntry = { type: 'exact'; origin: string } | { type: 'suffix'; hostSuffix: string };

/**
 * Normalize an origin string to lowercase URL.origin format
 */
function normalizeOrigin(value: string): string | null {
	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.origin.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * Parse ALLOWED_ORIGINS into structured entries
 * Format:
 * - Exact origins: "http://localhost:5173", "https://start.fun"
 * - Wildcard subdomains: ".ngrok-free.app", ".start.fun" (matches any subdomain)
 */
function parseAllowedOrigins(): AllowedEntry[] {
	// In dev mode, default to common localhost ports
	const defaultOrigins = 'http://localhost:5173,http://localhost:4173,http://localhost:3000';
	const rawOrigins = process.env.ALLOWED_ORIGINS || defaultOrigins;
	const items = rawOrigins
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	const entries: AllowedEntry[] = [];
	const nonProdMode = isNonProd();

	for (const item of items) {
		if (item.startsWith('.')) {
			const hostSuffix = item.toLowerCase();

			// Production safeguard: disallow untrusted wildcards like .ngrok-free.app
			if (
				!nonProdMode &&
				(hostSuffix.endsWith('.ngrok-free.app') || hostSuffix === '.ngrok-free.app')
			) {
				console.warn(`[origin] Ignoring disallowed wildcard in production: ${hostSuffix}`);
				continue;
			}

			entries.push({ type: 'suffix', hostSuffix });
		} else {
			const origin = normalizeOrigin(item);
			if (origin) {
				entries.push({ type: 'exact', origin });
			} else {
				console.warn(`[origin] Invalid origin in ALLOWED_ORIGINS: ${item}`);
			}
		}
	}

	return entries;
}

// Lazy-parse origins on first access (env vars not available at build time)
let parsedAllowedOrigins: AllowedEntry[] | null = null;

function getParsedOrigins(): AllowedEntry[] {
	if (!parsedAllowedOrigins) {
		parsedAllowedOrigins = parseAllowedOrigins();
	}
	return parsedAllowedOrigins;
}

/**
 * Get allowed origins (returns cached parsed entries)
 */
export function getAllowedOrigins(): AllowedEntry[] {
	return getParsedOrigins();
}

/**
 * Reload parsed origins from environment (for testing only)
 * @internal
 */
export function reloadAllowedOrigins(): void {
	parsedAllowedOrigins = parseAllowedOrigins();
}

/**
 * Check if a host matches a wildcard suffix (e.g., "abc.example.com" matches ".example.com")
 * Suffix must start with "." and host must have at least one subdomain label
 */
function hostMatchesSuffix(host: string, suffix: string): boolean {
	if (!suffix.startsWith('.')) {
		throw new Error(`Wildcard suffix must start with ".": ${suffix}`);
	}
	const lowerHost = host.toLowerCase();
	const lowerSuffix = suffix.toLowerCase();

	// Must end with suffix AND be longer (has subdomain)
	// E.g., "app.start.fun" ends with ".start.fun" and is longer
	// But "start.fun" does NOT end with ".start.fun" (suffix is longer)
	if (!lowerHost.endsWith(lowerSuffix)) {
		return false;
	}

	// Also ensure the host is longer than the suffix
	// This is redundant with endsWith check (can't end with longer string)
	// but makes intent clear
	return lowerHost.length > lowerSuffix.length;
}

/**
 * Validate request origin against allowlist with wildcard subdomain support
 * Returns matched origin for CORS reflection, or null if not allowed
 *
 * @param origin The Origin header from the request
 * @param referer Optional Referer header (used as fallback for same-origin detection)
 * @param host Optional Host header (used for same-origin validation)
 * @returns Matched origin string if allowed, null if not
 */
export function isOriginAllowed(
	origin: string | null,
	referer?: string | null,
	host?: string | null
): string | null {
	// SECURITY: Removed xOrigin parameter - only trust actual Origin header
	// If you need proxy support, set up a trusted reverse proxy that sets Origin correctly

	// Fallback: same-origin requests via Referer (browser may not send Origin for same-origin)
	if (!origin && referer && host) {
		try {
			const refererUrl = new URL(referer);
			if (refererUrl.host === host) {
				// Same-origin request - check if referer origin is allowlisted
				const refererOrigin = refererUrl.origin.toLowerCase();
				const refererHostname = refererUrl.hostname.toLowerCase();

				for (const entry of getParsedOrigins()) {
					if (entry.type === 'exact' && entry.origin === refererOrigin) {
						return refererOrigin;
					}
					if (entry.type === 'suffix' && hostMatchesSuffix(refererHostname, entry.hostSuffix)) {
						return refererOrigin;
					}
				}
			}
		} catch {
			// Invalid referer URL, fall through
		}
	}

	if (!origin || origin === 'null') return null;

	// Normalize and parse origin
	const normalized = normalizeOrigin(origin);
	if (!normalized) return null;

	let url: URL;
	try {
		url = new URL(normalized);
	} catch {
		return null;
	}

	// Use hostname (without port) for wildcard matching
	const requestHostname = url.hostname.toLowerCase();

	// Check against allowlist
	for (const entry of getParsedOrigins()) {
		if (entry.type === 'exact' && entry.origin === normalized) {
			return normalized;
		}
		if (entry.type === 'suffix' && hostMatchesSuffix(requestHostname, entry.hostSuffix)) {
			return normalized; // Reflect exact origin for CORS
		}
	}

	return null;
}

/**
 * Check origin and return error response if invalid
 * To be used at the start of auth endpoint handlers
 *
 * @param origin The Origin header from the request
 * @param referer Optional Referer header (used as fallback for same-origin detection)
 * @param host Optional Host header (used for same-origin validation)
 * @returns null if origin is valid, error response object if invalid
 */
export function validateOrigin(
	origin: string | null,
	referer?: string | null,
	host?: string | null
): { error: string; status: number } | null {
	const matchedOrigin = isOriginAllowed(origin, referer, host);
	if (!matchedOrigin) {
		return {
			error: 'Invalid or missing Origin header',
			status: 403
		};
	}
	return null;
}
