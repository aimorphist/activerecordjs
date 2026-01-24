import { eq, asc, desc, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getGlobalConnection } from './connection';

// Use 'any' liberally for metaprogramming per PRD: "TypeScript where helpful, any where necessary"

// Condition types for where clauses
type WhereCondition =
	| { type: 'eq'; column: string; value: unknown }
	| { type: 'raw'; sql: string; params: unknown[] };

type OrderDirection = 'asc' | 'desc';
type OrderCondition = { column: string; direction: OrderDirection };

interface QueryState {
	whereConditions: WhereCondition[];
	orderConditions: OrderCondition[];
	limitValue: number | null;
	offsetValue: number | null;
}

export class QueryBuilder<T extends PgTable, Instance> {
	private readonly table: T;
	private readonly state: QueryState;
	private readonly createInstance: (data: Record<string, unknown>, persisted: boolean) => Instance;
	private readonly modelClass: any; // Reference to ModelClass for create operations

	constructor(
		table: T,
		createInstance: (data: Record<string, unknown>, persisted: boolean) => Instance,
		modelClass: any,
		state?: Partial<QueryState>
	) {
		this.table = table;
		this.createInstance = createInstance;
		this.modelClass = modelClass;
		this.state = {
			whereConditions: state?.whereConditions ?? [],
			orderConditions: state?.orderConditions ?? [],
			limitValue: state?.limitValue ?? null,
			offsetValue: state?.offsetValue ?? null
		};
	}

	// Create a new QueryBuilder with modified state (immutability)
	private clone(updates: Partial<QueryState>): QueryBuilder<T, Instance> {
		return new QueryBuilder(this.table, this.createInstance, this.modelClass, {
			...this.state,
			...updates
		});
	}

	// Chain methods - return new QueryBuilder
	where(conditions: Record<string, unknown>): QueryBuilder<T, Instance>;
	where(sqlStr: string, ...params: unknown[]): QueryBuilder<T, Instance>;
	where(
		conditionsOrSql: Record<string, unknown> | string,
		...params: unknown[]
	): QueryBuilder<T, Instance> {
		const newConditions = [...this.state.whereConditions];

		if (typeof conditionsOrSql === 'string') {
			// Raw SQL condition
			newConditions.push({ type: 'raw', sql: conditionsOrSql, params });
		} else {
			// Hash conditions
			for (const [column, value] of Object.entries(conditionsOrSql)) {
				newConditions.push({ type: 'eq', column, value });
			}
		}

		return this.clone({ whereConditions: newConditions });
	}

	order(column: string, direction: OrderDirection = 'asc'): QueryBuilder<T, Instance> {
		return this.clone({
			orderConditions: [...this.state.orderConditions, { column, direction }]
		});
	}

	limit(n: number): QueryBuilder<T, Instance> {
		return this.clone({ limitValue: n });
	}

	offset(n: number): QueryBuilder<T, Instance> {
		return this.clone({ offsetValue: n });
	}

	// Build the Drizzle query with all accumulated conditions
	private buildQuery(db: PostgresJsDatabase) {
		let query: any = (db as any).select().from(this.table);

		// Apply where conditions
		for (const condition of this.state.whereConditions) {
			if (condition.type === 'eq') {
				query = query.where(eq((this.table as any)[condition.column], condition.value));
			} else if (condition.type === 'raw') {
				// Parse raw SQL with ? placeholders - convert to template literal
				query = query.where(sql.raw(this.interpolateParams(condition.sql, condition.params)));
			}
		}

		// Apply ordering
		for (const order of this.state.orderConditions) {
			const column = (this.table as any)[order.column];
			query = query.orderBy(order.direction === 'desc' ? desc(column) : asc(column));
		}

		// Apply limit
		if (this.state.limitValue !== null) {
			query = query.limit(this.state.limitValue);
		}

		// Apply offset
		if (this.state.offsetValue !== null) {
			query = query.offset(this.state.offsetValue);
		}

		return query;
	}

	// Simple parameter interpolation for raw SQL (parameterized for safety)
	private interpolateParams(sqlStr: string, params: unknown[]): string {
		let result = sqlStr;
		let paramIndex = 0;
		result = result.replace(/\?/g, () => {
			const param = params[paramIndex++];
			if (typeof param === 'string') {
				return `'${param.replace(/'/g, "''")}'`;
			}
			if (param === null) {
				return 'NULL';
			}
			return String(param);
		});
		return result;
	}

	// Terminal methods - execute query

	async all(): Promise<Instance[]> {
		const db = getGlobalConnection();
		const results = await this.buildQuery(db);
		return results.map((r: any) => this.createInstance(r, true));
	}

	async first(): Promise<Instance | null> {
		const limited = this.limit(1);
		const results = await limited.all();
		return results[0] ?? null;
	}

	async last(): Promise<Instance | null> {
		// Reverse the first ordering or use primary key desc
		const pk = this.modelClass.primaryKey;
		const reversed = this.clone({
			orderConditions:
				this.state.orderConditions.length > 0
					? this.state.orderConditions.map((o) => ({
							...o,
							direction: o.direction === 'asc' ? ('desc' as const) : ('asc' as const)
						}))
					: [{ column: pk, direction: 'desc' as const }]
		});
		return reversed.first();
	}

	async count(): Promise<number> {
		const db = getGlobalConnection();

		// Build count query
		let query: any = (db as any).select({ count: sql`count(*)` }).from(this.table);

		// Apply where conditions only (not order/limit/offset)
		for (const condition of this.state.whereConditions) {
			if (condition.type === 'eq') {
				query = query.where(eq((this.table as any)[condition.column], condition.value));
			} else if (condition.type === 'raw') {
				query = query.where(sql.raw(this.interpolateParams(condition.sql, condition.params)));
			}
		}

		const [result] = await query;
		return Number(result?.count ?? 0);
	}

	async exists(): Promise<boolean> {
		const count = await this.limit(1).count();
		return count > 0;
	}
}
