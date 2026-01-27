import type { BelongsToConfig, HasManyConfig } from './types';

/**
 * Infer foreign key from association name.
 * 'user' -> 'userId'
 * 'authorUser' -> 'authorUserId'
 */
export function inferBelongsToForeignKey(associationName: string): string {
  return associationName + 'Id';
}

/**
 * Infer foreign key from parent model's CLASS NAME (PascalCase).
 *
 * IMPORTANT: Pass the model's class name (e.g., 'User'), NOT the table name (e.g., 'users').
 *
 * Parent 'User' -> 'userId'
 * Parent 'BlogPost' -> 'blogPostId'
 */
export function inferHasManyForeignKey(parentModelName: string): string {
  // Convert 'User' to 'userId', 'BlogPost' to 'blogPostId'
  return parentModelName.charAt(0).toLowerCase() + parentModelName.slice(1) + 'Id';
}

/**
 * Resolve the foreign key for a belongsTo association.
 */
export function resolveBelongsToForeignKey(
  associationName: string,
  config: BelongsToConfig
): string {
  return config.foreignKey ?? inferBelongsToForeignKey(associationName);
}

/**
 * Resolve the foreign key for a hasMany association.
 *
 * @param parentModelName - The parent model's CLASS NAME (PascalCase), e.g., 'User'
 * @param config - The hasMany configuration
 */
export function resolveHasManyForeignKey(
  parentModelName: string,
  config: HasManyConfig
): string {
  return config.foreignKey ?? inferHasManyForeignKey(parentModelName);
}

/**
 * Load a belongsTo association.
 */
export async function loadBelongsTo(
  instance: any,
  associationName: string,
  config: BelongsToConfig
): Promise<any> {
  const foreignKey = resolveBelongsToForeignKey(associationName, config);
  const foreignKeyValue = instance._data[foreignKey];

  if (foreignKeyValue == null) {
    return null;  // No foreign key set
  }

  const RelatedModel = config.model();
  return RelatedModel.find(foreignKeyValue);
}
