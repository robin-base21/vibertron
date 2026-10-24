import { mkdirSync } from 'node:fs';
import type { App, Handler, Routes } from './app';
import { purgeExpiredSessions } from './auth/session';
import { migrateDb, openDb } from './db';
import { env as defaultEnv, type Env } from './env';
import { corsHeaders, errorResponse, json, notFound, withHeaders } from './http';
import { Live } from './live/broadcast';
import { adminRoutes } from './routes/admin';
import { attendeeRoutes } from './routes/attendee';
import { authRoutes } from './routes/auth';
import { eventRoutes } from './routes/events';
import { inviteRoutes } from './routes/invites';
import { joinRoutes } from './routes/join';

export interface ServerOptions {
	port?: number;
	dbPath?: string;
	env?: Partial<Env>;
	fetch?: typeof fetch;
	/** Run migrations on boot (default true). */
	migrate?: boolean;
}

export function createServer(opts: ServerOptions = {}) {
	const env: Env = { ...defaultEnv, ...opts.env };
	if (opts.port !== undefined) env.port = opts.port;
	if (opts.dbPath !== undefined) env.databasePath = opts.dbPath;

	const db = openDb(env.databasePath);
	if (opts.migrate !== false) migrateDb(db);
	mkdirSync(env.uploadDir, { recursive: true });

	const app: App = { db, env, live: new Live(), fetch: opts.fetch ?? fetch };
	const cors = corsHeaders(env.corsOrigin);

	const wrap =
		(h: Handler): Handler =>
		async (req) => {
			let res: Response;
			try {
				res = await h(req);
			} catch (err) {
				res = errorResponse(err);
			}
			return withHeaders(res, cors);
		};

	const routes: Routes = {
		'/api/health': { GET: () => json({ ok: true, time: Date.now() }) },
		...authRoutes(app),
		...adminRoutes(app),
		...eventRoutes(app),
		...inviteRoutes(app),
		...joinRoutes(app),
		...attendeeRoutes(app)
	};
	const wrapped: Routes = {};
	for (const [path, methods] of Object.entries(routes)) {
		wrapped[path] = Object.fromEntries(Object.entries(methods).map(([m, h]) => [m, wrap(h)]));
	}

	const server = Bun.serve<{ userId: string | null }>({
		port: env.port,
		routes: wrapped,
		fetch(req, server) {
			const url = new URL(req.url);
			if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
			if (url.pathname === '/ws') {
				if (server.upgrade(req, { data: { userId: null } })) return undefined;
				return new Response('WebSocket upgrade failed', { status: 400 });
			}
			const known = Object.keys(routes).some((p) => new RegExp(`^${p.replace(/:[^/]+/g, '[^/]+')}$`).test(url.pathname));
			const res = known
				? Response.json({ error: 'method_not_allowed', message: 'Method not allowed' }, { status: 405 })
				: errorResponse(notFound());
			return withHeaders(res, cors);
		},
		websocket: {
			message(ws, message) {
				ws.send(JSON.stringify({ type: 'pong', serverTime: Date.now() }));
			}
		}
	});
	app.live.attach(server);

	const timers = [setInterval(() => purgeExpiredSessions(db), 60 * 60 * 1000)];

	return {
		app,
		server,
		url: server.url.toString().replace(/\/$/, ''),
		async stop() {
			for (const t of timers) clearInterval(t);
			await server.stop(true);
			db.$client.close();
		}
	};
}
