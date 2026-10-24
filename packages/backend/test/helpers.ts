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

/** WebSocket test client that buffers messages and lets tests await a given type. */
export class WSClient {
	ws: WebSocket;
	messages: any[] = [];
	private waiters: { type: string; resolve: (m: any) => void }[] = [];

	constructor(base: string, cookie = '') {
		const url = base.replace(/^http/, 'ws') + '/ws';
		// Bun extension: headers on the upgrade request.
		this.ws = new WebSocket(url, { headers: cookie ? { cookie } : {} } as any);
		this.ws.onmessage = (e) => {
			const msg = JSON.parse(String(e.data));
			const i = this.waiters.findIndex((w) => w.type === msg.type);
			if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(msg);
			else this.messages.push(msg);
		};
	}

	opened() {
		return new Promise<void>((resolve, reject) => {
			if (this.ws.readyState === WebSocket.OPEN) return resolve();
			this.ws.onopen = () => resolve();
			this.ws.onerror = (e) => reject(e);
		});
	}

	send(msg: unknown) {
		this.ws.send(JSON.stringify(msg));
	}

	next<T = any>(type: string, timeoutMs = 2000): Promise<T> {
		const i = this.messages.findIndex((m) => m.type === type);
		if (i >= 0) return Promise.resolve(this.messages.splice(i, 1)[0]);
		return new Promise((resolve, reject) => {
			const waiter = { type, resolve };
			this.waiters.push(waiter);
			setTimeout(() => {
				const j = this.waiters.indexOf(waiter);
				if (j >= 0) {
					this.waiters.splice(j, 1);
					reject(new Error(`timeout waiting for ${type}; got ${JSON.stringify(this.messages.map((m) => m.type))}`));
				}
			}, timeoutMs);
		});
	}

	close() {
		this.ws.close();
	}
}

export async function connectWS(base: string, cookie = '') {
	const c = new WSClient(base, cookie);
	await c.opened();
	return c;
}
