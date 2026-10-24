import type { ServerWebSocket } from 'bun';
import { Role } from 'common';
import { env } from './src/env';

interface WSData {
	userId: string;
	role?: Role;
}

const connections = new Set<ServerWebSocket<WSData>>();

const corsHeaders = {
	'Access-Control-Allow-Origin': process.env.CORS_ORIGIN ?? 'http://localhost:3000',
	'Access-Control-Allow-Credentials': 'true'
};

const server = Bun.serve<WSData>({
	port: env.port,
	routes: {
		'/api/health': () => Response.json({ ok: true, time: Date.now() }, { headers: corsHeaders })
	},
	fetch(req, server) {
		const url = new URL(req.url);

		if (url.pathname === '/ws') {
			const upgraded = server.upgrade(req, { data: { userId: '' } });
			if (upgraded) return undefined;
			return new Response('WebSocket upgrade failed', { status: 400 });
		}

		return new Response('Not found', { status: 404, headers: corsHeaders });
	},
	websocket: {
		open(ws) {
			connections.add(ws);
		},

		message(ws, message) {
			try {
				const event = JSON.parse(message.toString());

				switch (event.type) {
					case 'ping':
						ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
						break;

					default:
						console.log('Unknown event type:', event.type);
				}
			} catch (error) {
				console.error('Error handling message:', error);
				ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
			}
		},

		close(ws) {
			connections.delete(ws);
		}
	}
});

console.log(`Vibertron backend running on http://localhost:${server.port} (ws: /ws)`);
