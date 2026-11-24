import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { siteEnv } from '../env';
import * as schema from './schema';

export type DB = ReturnType<typeof openDb>;

export function openDb(path: string) {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const sqlite = new Database(path, { create: true });
	sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
	return drizzle(sqlite, { schema });
}

let instance: DB | null = null;

/** The site database, migrated on first use. */
export function db(): DB {
	if (!instance) {
		instance = openDb(siteEnv.databasePath);
		migrate(instance, { migrationsFolder: resolve(process.env.SITE_MIGRATIONS ?? 'drizzle') });
	}
	return instance;
}
