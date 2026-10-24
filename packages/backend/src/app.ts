import type { BunRequest } from 'bun';
import type { DB } from './db';
import type { Env } from './env';
import type { Live } from './live/broadcast';

export interface App {
	db: DB;
	env: Env;
	live: Live;
	/** Injectable for tests (OpenRouter calls). */
	fetch: typeof fetch;
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Handler = (req: BunRequest) => Response | Promise<Response>;
export type Routes = Record<string, Partial<Record<Method, Handler>>>;
