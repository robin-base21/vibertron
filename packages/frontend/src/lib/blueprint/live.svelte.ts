import type { LiveSnapshotDTO, MessageDTO, ServerEvent, TeamDTO } from 'common';
import { upsertProject, withVoting } from './live/voting';
import { live } from '$lib/api';
import { wsStore } from '$lib/stores/websocket.svelte';
import { errorMessage } from '$lib/stores/toast.svelte';

const KEEP_MESSAGES = 50;
const FLASH_MS = 5000;

/** Public live state of one event (TV + viewer page): initial snapshot, then WS updates. */
export class LiveEvent {
	snapshot: LiveSnapshotDTO | null = $state.raw(null);
	error: string | null = $state(null);
	/** Team whose codename just changed, briefly highlighted on the blueprint. */
	flashTeamId: string | null = $state(null);

	#flashTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(public slug: string) {}

	get event() {
		return this.snapshot?.event ?? null;
	}

	/** Visible messages, newest first. */
	get messages(): MessageDTO[] {
		return (this.snapshot?.messages ?? []).filter((m) => !m.hidden).reverse();
	}

	/** Subscribe + fetch. Returns a cleanup function (use from $effect / onMount). */
	start(): () => void {
		const offs = [wsStore.on('*', (e) => this.handle(e)), wsStore.subscribe(this.slug, 'public')];
		this.refresh();
		return () => {
			offs.forEach((off) => off());
			clearTimeout(this.#flashTimer);
		};
	}

	/** Load from a fixture instead of the API (dev previews). */
	seed(snapshot: LiveSnapshotDTO) {
		this.snapshot = snapshot;
	}

	async refresh() {
		try {
			this.snapshot = await live.snapshot(this.slug);
			this.error = null;
		} catch (e) {
			if (!this.snapshot) this.error = errorMessage(e);
		}
	}

	#mine(eventId: string) {
		return this.snapshot?.event.id === eventId;
	}

	#patch(p: Partial<LiveSnapshotDTO>) {
		if (this.snapshot) this.snapshot = { ...this.snapshot, ...p };
	}

	handle(e: ServerEvent) {
		const s = this.snapshot;
		switch (e.type) {
			case 'subscribed':
				if (e.slug === this.slug) this.snapshot = e.snapshot;
				return;
			case 'launched':
				if (e.snapshot.event.slug === this.slug) this.snapshot = e.snapshot;
				return;
		}
		if (!s) return;
		switch (e.type) {
			case 'event.updated':
				if (this.#mine(e.event.id)) this.#patch({ event: e.event });
				return;
			case 'blueprint.updated':
				if (this.#mine(e.eventId)) this.#patch({ blueprint: e.blueprint });
				return;
			case 'team.updated':
				if (this.#mine(e.team.eventId)) this.#upsertTeam(e.team);
				return;
			case 'message.created':
				if (this.#mine(e.message.eventId) && !s.messages.some((m) => m.id === e.message.id)) {
					this.#patch({ messages: [...s.messages, e.message].slice(-KEEP_MESSAGES) });
				}
				return;
			case 'message.hidden':
				if (!s.messages.some((m) => m.id === e.messageId)) {
					// Un-hiding a message we never had: re-read the snapshot.
					if (!e.hidden) this.refresh();
					return;
				}
				this.#patch({
					messages: s.messages.map((m) => (m.id === e.messageId ? { ...m, hidden: e.hidden } : m))
				});
				return;
			case 'participants.count':
				if (this.#mine(e.eventId)) this.#patch({ participantCount: e.count });
				return;
			case 'project.updated':
				if (this.#mine(e.project.eventId))
					this.#patch({ projects: upsertProject(s.projects, e.project) });
				return;
			case 'voting.updated':
				if (this.#mine(e.eventId)) this.snapshot = withVoting(s, e.voting);
				return;
		}
	}

	#upsertTeam(team: TeamDTO) {
		const teams = this.snapshot!.teams;
		const prev = teams.find((t) => t.id === team.id);
		this.#patch({
			teams: prev ? teams.map((t) => (t.id === team.id ? team : t)) : [...teams, team]
		});
		if (team.codename && team.codename !== prev?.codename) {
			this.flashTeamId = team.id;
			clearTimeout(this.#flashTimer);
			this.#flashTimer = setTimeout(() => (this.flashTeamId = null), FLASH_MS);
		}
	}
}

/** `HH:MM:SS` for a duration in ms, clamped at zero. */
export function hms(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export type LivePhase = 'loading' | 'missing' | 'pre' | 'live' | 'ended';

export function livePhase(
	snapshot: LiveSnapshotDTO | null,
	error: string | null,
	now: number
): LivePhase {
	if (!snapshot) return error ? 'missing' : 'loading';
	const ev = snapshot.event;
	if (ev.status === 'ended') return 'ended';
	if (ev.status === 'live') return ev.endsAt !== null && ev.endsAt <= now ? 'ended' : 'live';
	return 'pre';
}
