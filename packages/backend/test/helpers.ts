import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedAdmin } from '../src/db/seed';
import { createServer, type ServerOptions } from '../src/server';

export const ADMIN = { email: 'admin@test.dev', password: 'admin-password' };

export async function bootTestServer(opts: ServerOptions = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'vibertron-test-'));
	const srv = createServer({
		port: 0,
		dbPath: join(dir, 'test.sqlite'),
		...opts,
		env: { uploadDir: join(dir, 'uploads'), corsOrigin: 'http://localhost:3000', openrouterApiKey: '', ...opts.env }
	});
	await seedAdmin(srv.app.db, ADMIN.email, ADMIN.password);
	return {
		...srv,
		dir,
		client: () => new Client(srv.url),
		async close() {
			await srv.stop();
			rmSync(dir, { recursive: true, force: true });
		}
	};
}

/** Minimal fetch wrapper with a cookie jar for the session cookie. */
export class Client {
	cookie = '';
	constructor(public base: string) {}

	async req<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T; res: Response }> {
		const headers: Record<string, string> = {};
		if (this.cookie) headers.cookie = this.cookie;
		let payload: FormData | string | undefined;
		if (body instanceof FormData) payload = body;
		else if (body !== undefined) {
			headers['content-type'] = 'application/json';
			payload = JSON.stringify(body);
		}
		const res = await fetch(this.base + path, { method, headers, body: payload });
		const setCookie = res.headers.get('set-cookie');
		if (setCookie) {
			const pair = setCookie.split(';')[0]!;
			this.cookie = pair.endsWith('=') ? '' : pair;
		}
		const type = res.headers.get('content-type') ?? '';
		const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
		return { status: res.status, body: data as T, res };
	}

	get<T = any>(path: string) {
		return this.req<T>('GET', path);
	}
	post<T = any>(path: string, body?: unknown) {
		return this.req<T>('POST', path, body ?? {});
	}
	put<T = any>(path: string, body?: unknown) {
		return this.req<T>('PUT', path, body);
	}
	patch<T = any>(path: string, body?: unknown) {
		return this.req<T>('PATCH', path, body);
	}
	del<T = any>(path: string) {
		return this.req<T>('DELETE', path);
	}

	async login(email: string, password: string) {
		const r = await this.post('/api/auth/login', { email, password });
		if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
		return r.body.user;
	}
}
