/**
 * A fake Drizzle Postgres session for scope tests. It records every driver
 * method call as `<label>:<op>` and distinguishes the root session from the
 * transaction session it hands to a transaction callback (`<label>:tx`).
 */
export interface FakeSessionOptions {
	/** Rows returned by every select/insert/execute. */
	rows?: Record<string, unknown>[];
	/** Make commit throw after the callback resolves. */
	failCommit?: boolean;
	/** Awaited before commit completes (to observe the pending-commit window). */
	commitGate?: Promise<void>;
}

export interface FakeSession {
	label: string;
	log: string[];
	rows: Record<string, unknown>[];
	[key: string]: any;
}

export function fakeSession(
	label: string,
	log: string[] = [],
	options: FakeSessionOptions = {}
): FakeSession {
	const rows = options.rows ?? [];

	const chain = (op: string) => {
		log.push(`${label}:${op}`);
		const result = () => Promise.resolve(rows.map((r) => ({ ...r })));
		const q: any = {
			from: () => q,
			where: () => q,
			orderBy: () => q,
			limit: () => q,
			offset: () => q,
			values: () => q,
			set: () => q,
			returning: result,
			then: (resolve: any, reject: any) => result().then(resolve, reject)
		};
		return q;
	};

	const session: FakeSession = {
		label,
		log,
		rows,
		select: () => chain('select'),
		insert: () => chain('insert'),
		update: () => chain('update'),
		delete: () => chain('delete'),
		execute: async () => {
			log.push(`${label}:execute`);
			return rows.map((r) => ({ ...r }));
		},
		transaction: async (cb: (tx: any) => Promise<unknown>) => {
			log.push(`${label}:begin`);
			const tx = fakeSession(`${label}:tx`, log, { rows });
			let result: unknown;
			try {
				result = await cb(tx);
			} catch (error) {
				log.push(`${label}:rollback`);
				throw error;
			}
			if (options.commitGate) await options.commitGate;
			if (options.failCommit) {
				log.push(`${label}:commit-failed`);
				throw new Error('commit failed');
			}
			log.push(`${label}:commit`);
			return result;
		}
	};
	return session;
}

