import { eq, asc, desc, sql, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { eagerLoad } from './eager-loader';
import { captureScope, requireScope, type ConnectionScope, type PgSession } from './session';

// Use 'any' liberally for metaprogramming per PRD: "TypeScript where helpful, any where necessary"

// Condition types for where clauses
type WhereCondition =
	| { type: 'eq'; column: string; value: unknown }
	| { type: 'in'; column: string; values: unknown[] }
	| { type: 'raw'; sql: string; params: unknown[] };

type OrderDirection = 'asc' | 'desc';
type OrderCondition = { column: string; direction: OrderDirection };

type InstanceFactory<Instance> = (
	data: Record<string, unknown>,
	persisted: boolean,
	scope: ConnectionScope | null
) => Instance;

interface QueryState {
	whereConditions: WhereCondition[];
	orderConditions: OrderCondition[];
	limitValue: number | null;
	offsetValue: number | null;
	includesAssociations: string[];
}

export class QueryBuilder<T extends PgTable, Instance> {
	private readonly table: T;
	private readonly state: QueryState;
	private readonly createInstance: InstanceFactory<Instance>;
	private readonly modelClass: any; // Reference to ModelClass for create operations
	/** Scope captured at creation; it beats any ambient scope bound later. */
	readonly scope: ConnectionScope | null;

	constructor(
		table: T,
		createInstance: InstanceFactory<Instance>,
		modelClass: any,
		state?: Partial<QueryState>,
		scope?: ConnectionScope | null
	) {
		this.table = table;
		this.createInstance = createInstance;
		this.modelClass = modelClass;
		this.scope = scope !== undefined ? scope : captureScope(modelClass?.connectionScope);
		this.state = {
			whereConditions: state?.whereConditions ?? [],
			orderConditions: state?.orderConditions ?? [],
			limitValue: state?.limitValue ?? null,
			offsetValue: state?.offsetValue ?? null,
			includesAssociations: state?.includesAssociations ?? []
		};
	}

	// Create a new QueryBuilder with modified state (immutability)
	private clone(updates: Partial<QueryState>): QueryBuilder<T, Instance> {
		return new QueryBuilder(
			this.table,
			this.createInstance,
			this.modelClass,
			{ ...this.state, ...updates },
			this.scope
		);
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

	whereIn(column: string, values: unknown[]): QueryBuilder<T, Instance> {
		if (values.length === 0) {
			// Empty IN always returns nothing - use a raw condition that is always false
			return this.clone({
				whereConditions: [...this.state.whereConditions, { type: 'raw', sql: '1 = 0', params: [] }]
			});
		}
		return this.clone({
			whereConditions: [...this.state.whereConditions, { type: 'in', column, values }]
		});
	}

	includes(...associations: string[]): QueryBuilder<T, Instance> {
		return this.clone({
			includesAssociations: [...this.state.includesAssociations, ...associations]
		});
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
	private buildQuery(db: PgSession) {
		let query: any = (db as any).select().from(this.table);

		// Apply where conditions
		for (const condition of this.state.whereConditions) {
			if (condition.type === 'eq') {
				query = query.where(eq((this.table as any)[condition.column], condition.value));
			} else if (condition.type === 'in') {
				query = query.where(inArray((this.table as any)[condition.column], condition.values));
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
		const db = requireScope(this.scope).session();
		const results = await this.buildQuery(db);
		const instances = results.map((r: any) => this.createInstance(r, true, this.scope));

		// Eager load if includes were specified
		if (this.state.includesAssociations.length > 0) {
			await eagerLoad(instances, this.state.includesAssociations, this.modelClass, this.scope);
		}

		return instances;
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
		const db = requireScope(this.scope).session();

		// Build count query
		let query: any = (db as any).select({ count: sql`count(*)` }).from(this.table);

		// Apply where conditions only (not order/limit/offset)
		for (const condition of this.state.whereConditions) {
			if (condition.type === 'eq') {
				query = query.where(eq((this.table as any)[condition.column], condition.value));
			} else if (condition.type === 'in') {
				query = query.where(inArray((this.table as any)[condition.column], condition.values));
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
