import { sql } from 'drizzle-orm';
import type { HasAndBelongsToManyConfig } from './types';
import { resolveHABTMConfig, toSnakeCase } from './associations';
import { bindModel, requireScope, scopeOf } from './session';

/**
 * HABTMCollectionProxy wraps a many-to-many association via join table.
 * - Awaitable: `await post.tags` returns Tag[]
 * - .add(record): INSERT into join table
 * - .remove(record): DELETE from join table
 * - .ids(): returns target IDs
 * - .count(): COUNT via join table
 * - .empty(): boolean
 * - .includes(record): check membership
 */
export class HABTMCollectionProxy<T> implements PromiseLike<T[]> {
	private readonly owner: any;
	private readonly associationName: string;
	private readonly config: HasAndBelongsToManyConfig;
	private readonly ownerModelClass: any;
	private readonly resolved: {
		joinTable: string;
		foreignKey: string;
		associationForeignKey: string;
	};

	constructor(
		owner: any,
		associationName: string,
		config: HasAndBelongsToManyConfig,
		ownerModelClass: any
	) {
		this.owner = owner;
		this.associationName = associationName;
		this.config = config;
		this.ownerModelClass = ownerModelClass;
		this.resolved = resolveHABTMConfig(ownerModelClass, config);
	}

	/** The owner's captured scope session; throws before driver I/O when none resolves. */
	private session() {
		return requireScope(scopeOf(this.owner)).session();
	}

	private targetModel(): any {
		return bindModel(this.config.model(), scopeOf(this.owner));
	}

	private get ownerPK(): unknown {
		return this.owner._data[this.ownerModelClass.primaryKey];
	}

	private async loadTargetIds(): Promise<number[]> {
		if (this.ownerPK == null) return [];

		const db = this.session();
		const fkCol = toSnakeCase(this.resolved.foreignKey);
		const assocFkCol = toSnakeCase(this.resolved.associationForeignKey);
		const result = await db.execute(
			sql`SELECT ${sql.raw(assocFkCol)} FROM ${sql.raw(this.resolved.joinTable)} WHERE ${sql.raw(fkCol)} = ${this.ownerPK}`
		);
		return (result as any[]).map((r: any) => r[assocFkCol]);
	}

	private async load(): Promise<T[]> {
		if (this.associationName in this.owner._associations) {
			return this.owner._associations[this.associationName] as T[];
		}

		const targetIds = await this.loadTargetIds();
		if (targetIds.length === 0) {
			this.owner._associations[this.associationName] = [];
			return [];
		}

		const TargetModel = this.targetModel();
		const result = await TargetModel.where({}).whereIn(TargetModel.primaryKey, targetIds).all();
		this.owner._associations[this.associationName] = result;
		return result;
	}

	then<TResult1 = T[], TResult2 = never>(
		onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
	): Promise<TResult1 | TResult2> {
		return this.load().then(onfulfilled, onrejected);
	}

	async add(record: any): Promise<void> {
		const db = this.session();
		const targetPK = record._data[this.config.model().primaryKey];
		const fkCol = toSnakeCase(this.resolved.foreignKey);
		const assocFkCol = toSnakeCase(this.resolved.associationForeignKey);
		await db.execute(
			sql`INSERT INTO ${sql.raw(this.resolved.joinTable)} (${sql.raw(fkCol)}, ${sql.raw(assocFkCol)}) VALUES (${this.ownerPK}, ${targetPK}) ON CONFLICT DO NOTHING`
		);
		delete this.owner._associations[this.associationName]; // Invalidate cache
	}

	async remove(record: any): Promise<void> {
		const db = this.session();
		const targetPK = record._data[this.config.model().primaryKey];
		const fkCol = toSnakeCase(this.resolved.foreignKey);
		const assocFkCol = toSnakeCase(this.resolved.associationForeignKey);
		await db.execute(
			sql`DELETE FROM ${sql.raw(this.resolved.joinTable)} WHERE ${sql.raw(fkCol)} = ${this.ownerPK} AND ${sql.raw(assocFkCol)} = ${targetPK}`
		);
		delete this.owner._associations[this.associationName]; // Invalidate cache
	}

	async count(): Promise<number> {
		if (this.ownerPK == null) return 0;

		const db = this.session();
		const fkCol = toSnakeCase(this.resolved.foreignKey);
		const result = await db.execute(
			sql`SELECT COUNT(*) as count FROM ${sql.raw(this.resolved.joinTable)} WHERE ${sql.raw(fkCol)} = ${this.ownerPK}`
		);
		return Number((result as any[])[0]?.count ?? 0);
	}

	async ids(): Promise<number[]> {
		return this.loadTargetIds();
	}

	async empty(): Promise<boolean> {
		return (await this.count()) === 0;
	}

	async includes(record: any): Promise<boolean> {
		if (this.ownerPK == null) return false;

		const TargetModel = this.targetModel();
		const targetPK =
			record._data?.[TargetModel.primaryKey] ?? record[TargetModel.primaryKey] ?? record;
		const db = this.session();
		const fkCol = toSnakeCase(this.resolved.foreignKey);
		const assocFkCol = toSnakeCase(this.resolved.associationForeignKey);
		const result = await db.execute(
			sql`SELECT COUNT(*) as count FROM ${sql.raw(this.resolved.joinTable)} WHERE ${sql.raw(fkCol)} = ${this.ownerPK} AND ${sql.raw(assocFkCol)} = ${targetPK}`
		);
		return Number((result as any[])[0]?.count ?? 0) > 0;
	}

	reset(): void {
		delete this.owner._associations[this.associationName];
	}
}
