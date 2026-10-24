import { createSubscriber } from 'svelte/reactivity';
import { wsStore } from '$lib/stores/websocket.svelte';

/** A server-corrected clock that only ticks while something reactive reads `now`. */
class Clock {
	#subscribe = createSubscriber((update) => {
		const timer = setInterval(update, 250);
		return () => clearInterval(timer);
	});

	get now(): number {
		this.#subscribe();
		return wsStore.now();
	}
}

export const clock = new Clock();

/** `H:MM:SS` (or `MM:SS` below an hour) for a duration in ms, clamped at zero. */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const mm = String(m).padStart(2, '0');
	const ss = String(s).padStart(2, '0');
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
