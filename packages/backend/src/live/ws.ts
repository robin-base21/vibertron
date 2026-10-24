import { ClientEvent, topics, type ServerEvent } from 'common';
import type { ServerWebSocket, WebSocketHandler } from 'bun';
import { eq } from 'drizzle-orm';
import type { App } from '../app';
import { canManage } from '../auth/guards';
import { getSessionUser } from '../auth/session';
import { events, users } from '../db/schema';
import { liveSnapshot } from '../dto';

export interface WSData {
	userId: string | null;
	/** slug -> topics subscribed for it */
	subs: Map<string, string[]>;
}

export function wsData(app: App, req: Request): WSData {
	return { userId: getSessionUser(app.db, req)?.id ?? null, subs: new Map() };
}

const send = (ws: ServerWebSocket<WSData>, event: ServerEvent): void => {
	ws.send(JSON.stringify(event));
};

export function websocketHandlers(app: App): WebSocketHandler<WSData> {
	const { db } = app;

	const unsubscribe = (ws: ServerWebSocket<WSData>, slug: string) => {
		for (const t of ws.data.subs.get(slug) ?? []) ws.unsubscribe(t);
		ws.data.subs.delete(slug);
	};

	return {
		idleTimeout: 120,
		open(ws) {
			if (ws.data.userId) ws.subscribe(topics.user(ws.data.userId));
		},
		message(ws, raw) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(String(raw));
			} catch {
				return send(ws, { type: 'error', message: 'Invalid JSON' });
			}
			const result = ClientEvent.safeParse(parsed);
			if (!result.success) return send(ws, { type: 'error', message: 'Invalid message' });
			const msg = result.data;

			switch (msg.type) {
				case 'ping':
					return send(ws, { type: 'pong', serverTime: Date.now() });
				case 'unsubscribe':
					return unsubscribe(ws, msg.slug);
				case 'subscribe': {
					const event = db.select().from(events).where(eq(events.slug, msg.slug)).get();
					if (!event) return send(ws, { type: 'error', message: `Event ${msg.slug} not found` });
					// Re-read the user so role changes and deletions since the upgrade apply.
					const user = ws.data.userId ? (db.select().from(users).where(eq(users.id, ws.data.userId)).get() ?? null) : null;
					const manage = msg.scope === 'manage';
					if (manage && !canManage(user, event)) return send(ws, { type: 'error', message: 'Not allowed to manage this event' });
					unsubscribe(ws, msg.slug);
					const subs = manage ? [topics.event(event.id), topics.manage(event.id)] : [topics.event(event.id)];
					for (const t of subs) ws.subscribe(t);
					ws.data.subs.set(msg.slug, subs);
					return send(ws, { type: 'subscribed', slug: msg.slug, scope: msg.scope, snapshot: liveSnapshot(db, event, manage) });
				}
			}
		}
	};
}
