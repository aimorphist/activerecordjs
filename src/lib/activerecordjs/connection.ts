import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

let globalDb: PostgresJsDatabase | null = null;

export function setGlobalConnection(db: PostgresJsDatabase): void {
	globalDb = db;
}

export function getGlobalConnection(): PostgresJsDatabase {
	if (!globalDb) {
		throw new Error(
			'No database connection. Call createActiveRecordJS(db) first or pass connection to Model().'
		);
	}
	return globalDb;
}

export function createConnection(connectionString: string): PostgresJsDatabase {
	const client = postgres(connectionString);
	return drizzle(client);
}
