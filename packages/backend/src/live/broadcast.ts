import { topics, type ServerEvent } from 'common';
import type { Server } from 'bun';

/** Thin wrapper over server.publish so routes can emit typed ServerEvents. */
export class Live {
	private server: Server<unknown> | null = null;

	attach(server: Server<unknown>) {
		this.server = server;
	}

	publish(topic: string, event: ServerEvent) {
		this.server?.publish(topic, JSON.stringify(event));
	}

	toEvent(eventId: string, event: ServerEvent) {
		this.publish(topics.event(eventId), event);
	}

	toManagers(eventId: string, event: ServerEvent) {
		this.publish(topics.manage(eventId), event);
	}

	toUser(userId: string, event: ServerEvent) {
		this.publish(topics.user(userId), event);
	}
}
