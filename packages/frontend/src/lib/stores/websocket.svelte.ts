import { browser } from '$app/environment';
import { WS_URL } from '$lib/env';
import type { ClientEvent, ServerEvent } from 'common';

type Handler<T extends ServerEvent['type']> = (event: Extract<ServerEvent, { type: T }>) => void;
type Scope = 'public' | 'manage';

class WebSocketStore {
	ws: WebSocket | null = $state(null);
	connected = $state(false);
	error: string | null = $state(null);
	/** serverTime - Date.now(), refreshed on every pong / timed event. Use `now()` for countdowns. */
	clockOffset = $state(0);

	#handlers = new Map<string, Set<(e: ServerEvent) => void>>();
	#subscriptions = new Map<string, Scope>();
	#ping: ReturnType<typeof setInterval> | undefined;
	#retry: ReturnType<typeof setTimeout> | undefined;
	#closing = false;

	connect() {
		if (!browser || this.ws) return;
		this.#closing = false;
		clearTimeout(this.#retry);
		const ws = new WebSocket(WS_URL);
		this.ws = ws;
		// Handlers ignore events from sockets that were replaced (e.g. by reconnect()).
		const current = () => this.ws === ws;

		ws.onopen = () => {
			if (!current()) return;
			this.connected = true;
			this.error = null;
			this.send({ type: 'ping' });
			for (const [slug, scope] of this.#subscriptions)
				this.send({ type: 'subscribe', slug, scope });
			clearInterval(this.#ping);
			this.#ping = setInterval(() => this.send({ type: 'ping' }), 30_000);
		};

		ws.onmessage = (event) => {
			if (!current()) return;
			try {
				this.#dispatch(JSON.parse(event.data) as ServerEvent);
			} catch (error) {
				console.error('Error parsing WebSocket message:', error);
			}
		};

		ws.onerror = () => {
			if (current()) this.error = 'Connection error';
		};

		ws.onclose = () => {
			if (!current()) return;
			this.connected = false;
			this.ws = null;
			clearInterval(this.#ping);
			if (this.#closing) return;
			// Attempt to reconnect after 3 seconds
			this.#retry = setTimeout(() => {
				if (!this.ws) this.connect();
			}, 3000);
		};
	}

	/** Reconnect so the server picks up a new session cookie (after login/join). */
	reconnect() {
		this.disconnect();
		this.connect();
	}

	#dispatch(event: ServerEvent) {
		if (event.type === 'pong' || event.type === 'event.updated')
			this.clockOffset = event.serverTime - Date.now();
		if (event.type === 'subscribed' || event.type === 'launched')
			this.clockOffset = event.snapshot.serverTime - Date.now();
		if (event.type === 'error') this.error = event.message;
		for (const h of this.#handlers.get(event.type) ?? []) h(event);
		for (const h of this.#handlers.get('*') ?? []) h(event);
	}

	/** Listen for a server event type ('*' for all). Returns an unsubscribe function. */
	on<T extends ServerEvent['type']>(type: T | '*', handler: Handler<T>): () => void {
		const set = this.#handlers.get(type) ?? new Set();
		set.add(handler as (e: ServerEvent) => void);
		this.#handlers.set(type, set);
		return () => set.delete(handler as (e: ServerEvent) => void);
	}

	/** Subscribe to an event's live topic; re-sent automatically after reconnects. */
	subscribe(slug: string, scope: Scope = 'public'): () => void {
		this.#subscriptions.set(slug, scope);
		this.connect();
		this.send({ type: 'subscribe', slug, scope });
		return () => {
			this.#subscriptions.delete(slug);
			this.send({ type: 'unsubscribe', slug });
		};
	}

	now(): number {
		return Date.now() + this.clockOffset;
	}

	send(event: ClientEvent) {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
	}

	disconnect() {
		this.#closing = true;
		clearInterval(this.#ping);
		clearTimeout(this.#retry);
		this.ws?.close();
		this.ws = null;
		this.connected = false;
	}
}

export const wsStore = new WebSocketStore();
