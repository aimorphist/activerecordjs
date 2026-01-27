import type { HasManyConfig } from './types';
import { resolveHasManyForeignKey } from './associations';

/**
 * CollectionProxy wraps a hasMany association.
 * - Awaitable: `await user.posts` returns Post[]
 * - Has methods: `.count()`, `.build()`, `.create()`
 */
export class CollectionProxy<T> implements PromiseLike<T[]> {
  private readonly owner: any;
  private readonly associationName: string;
  private readonly config: HasManyConfig;
  private readonly parentModelName: string;

  constructor(
    owner: any,
    associationName: string,
    config: HasManyConfig,
    parentModelName: string
  ) {
    this.owner = owner;
    this.associationName = associationName;
    this.config = config;
    this.parentModelName = parentModelName;
  }

  /**
   * Load the association (uses owner's _associations cache).
   */
  private async load(): Promise<T[]> {
    // Check instance cache first
    if (this.associationName in this.owner._associations) {
      return this.owner._associations[this.associationName] as T[];
    }

    const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
    const ModelClass = this.owner.constructor;
    const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

    if (primaryKeyValue == null) {
      const result: T[] = [];
      this.owner._associations[this.associationName] = result;
      return result;
    }

    const RelatedModel = this.config.model();
    const result = await RelatedModel.where({ [foreignKey]: primaryKeyValue }).all();
    this.owner._associations[this.associationName] = result;
    return result;
  }

  /**
   * Implement PromiseLike for `await user.posts`.
   */
  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.load().then(onfulfilled, onrejected);
  }

  /**
   * Count related records without loading them all.
   */
  async count(): Promise<number> {
    const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
    const ModelClass = this.owner.constructor;
    const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

    if (primaryKeyValue == null) {
      return 0;
    }

    const RelatedModel = this.config.model();
    return RelatedModel.where({ [foreignKey]: primaryKeyValue }).count();
  }

  /**
   * Build a new related record (not saved) with foreign key set.
   */
  build(attrs: Record<string, unknown> = {}): T {
    const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
    const ModelClass = this.owner.constructor;
    const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

    const RelatedModel = this.config.model();
    return RelatedModel.build({
      ...attrs,
      [foreignKey]: primaryKeyValue
    }) as T;
  }

  /**
   * Create and save a new related record with foreign key set.
   */
  async create(attrs: Record<string, unknown> = {}): Promise<T> {
    const foreignKey = resolveHasManyForeignKey(this.parentModelName, this.config);
    const ModelClass = this.owner.constructor;
    const primaryKeyValue = this.owner._data[ModelClass.primaryKey];

    const RelatedModel = this.config.model();
    const instance = await RelatedModel.create({
      ...attrs,
      [foreignKey]: primaryKeyValue
    });

    // Invalidate cache so next load gets fresh data
    if (this.associationName in this.owner._associations) {
      delete this.owner._associations[this.associationName];
    }

    return instance as T;
  }

  /**
   * Clear the loaded cache.
   */
  reset(): void {
    if (this.associationName in this.owner._associations) {
      delete this.owner._associations[this.associationName];
    }
  }
}
