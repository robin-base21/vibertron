import { browser } from '$app/environment';
import { WS_URL } from '$lib/env';

interface WSEvent {
	type: string;
	[key: string]: unknown;
}

class WebSocketStore {
	ws: WebSocket | null = $state(null);
	connected = $state(false);
	error: string | null = $state(null);

	connect() {
		if (!browser || this.ws) return;

		this.ws = new WebSocket(WS_URL);

		this.ws.onopen = () => {
			this.connected = true;
			this.error = null;
		};

		this.ws.onmessage = (event) => {
			try {
				const data: WSEvent = JSON.parse(event.data);
				this.handleMessage(data);
			} catch (error) {
				console.error('Error parsing WebSocket message:', error);
			}
		};

		this.ws.onerror = () => {
			this.error = 'Connection error';
		};

		this.ws.onclose = () => {
			this.connected = false;
			this.ws = null;

			// Attempt to reconnect after 3 seconds
			setTimeout(() => {
				if (!this.connected) this.connect();
			}, 3000);
		};
	}

	handleMessage(event: WSEvent) {
		switch (event.type) {
			case 'error':
				this.error = event.message as string;
				console.error('Server error:', event.message);
				break;
		}
	}

	send(event: WSEvent) {
		if (this.ws && this.connected) {
			this.ws.send(JSON.stringify(event));
		} else {
			console.error('WebSocket not connected');
		}
	}

	disconnect() {
		this.ws?.close();
		this.ws = null;
	}
}

export const wsStore = new WebSocketStore();
