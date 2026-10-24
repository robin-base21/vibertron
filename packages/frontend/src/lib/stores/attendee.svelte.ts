import { attendee } from '$lib/api';
import { handleError } from '$lib/stores/toast.svelte';
import { wsStore } from '$lib/stores/websocket.svelte';
import {
	parseStationId,
	type AttendeeContextDTO,
	type LiveSnapshotDTO,
	type MessageDTO,
	type PairingDTO
} from 'common';

const FEED_LIMIT = 50;

/** Live state of the attendee page for one event: context from `/me` kept fresh over WS. */
export class AttendeeState {
	ctx: AttendeeContextDTO = $state()!;
	/** Null until the live snapshot or a WS count arrives. */
	participantCount = $state<number | null>(null);
	messages: MessageDTO[] = $state([]);

	constructor(ctx: AttendeeContextDTO, snapshot: LiveSnapshotDTO | null) {
		this.ctx = ctx;
		if (snapshot) this.#applySnapshot(snapshot);
	}

	get slug() {
		return this.ctx.event.slug;
	}

	get me() {
		return this.ctx.participant;
	}

	get incoming(): PairingDTO[] {
		return this.ctx.pairings.filter((p) => !p.accepted && p.toParticipantId === this.me.id);
	}

	get outgoing(): PairingDTO[] {
		return this.ctx.pairings.filter((p) => !p.accepted && p.fromParticipantId === this.me.id);
	}

	get accepted(): PairingDTO[] {
		return this.ctx.pairings.filter((p) => p.accepted);
	}

	/** The other side of a pairing. */
	partnerName(p: PairingDTO): string {
		return p.fromParticipantId === this.me.id ? p.toName : p.fromName;
	}

	get segment() {
		const parsed = this.ctx.stationId ? parseStationId(this.ctx.stationId) : null;
		const segmentId = parsed?.segmentId ?? this.ctx.team?.segmentId;
		return this.ctx.blueprint?.segments.find((s) => s.id === segmentId) ?? null;
	}

	/** 1-based station number within the segment. */
	get stationNumber(): number | null {
		const parsed = this.ctx.stationId ? parseStationId(this.ctx.stationId) : null;
		return parsed ? parsed.index + 1 : null;
	}

	get teammates() {
		return this.ctx.team?.members.filter((m) => m.participantId !== this.me.id) ?? [];
	}

	/** Subscribe to the event's public topic plus personal events. Returns the cleanup. */
	connect(): () => void {
		const eventId = this.ctx.event.id;
		const offs = [
			wsStore.subscribe(this.slug, 'public'),
			wsStore.on('subscribed', (e) => {
				if (e.snapshot.event.id === eventId) this.#applySnapshot(e.snapshot);
			}),
			wsStore.on('event.updated', (e) => {
				if (e.event.id === eventId) this.ctx.event = e.event;
			}),
			wsStore.on('participants.count', (e) => {
				if (e.eventId === eventId) this.participantCount = e.count;
			}),
			wsStore.on('launched', (e) => {
				if (e.snapshot.event.id !== eventId) return;
				this.#applySnapshot(e.snapshot);
				// Our own team/station comes from `assignment`, but refetch in case we missed it.
				this.reload();
			}),
			wsStore.on('blueprint.updated', (e) => {
				if (e.eventId === eventId) this.ctx.blueprint = e.blueprint;
			}),
			wsStore.on('assignment', (e) => {
				if (e.eventId !== eventId) return;
				this.ctx.team = e.team;
				this.ctx.stationId = e.stationId;
			}),
			wsStore.on('team.updated', (e) => {
				if (e.team.id === this.ctx.team?.id) this.ctx.team = e.team;
			}),
			wsStore.on('pairing.updated', (e) => {
				// Personal topic: ignore pairings from the user's other events.
				const { fromParticipantId: from, toParticipantId: to } = e.pairing;
				if (from === this.me.id || to === this.me.id) this.#upsertPairing(e.pairing, e.removed);
			}),
			wsStore.on('message.created', (e) => {
				if (e.message.eventId === eventId) this.#addMessage(e.message);
			}),
			wsStore.on('message.hidden', (e) => {
				if (e.hidden) this.messages = this.messages.filter((m) => m.id !== e.messageId);
			})
		];
		return () => offs.forEach((off) => off());
	}

	async reload() {
		try {
			this.ctx = await attendee.me(this.slug);
		} catch (err) {
			handleError(err);
		}
	}

	async pair(friendCode: string) {
		const { pairing } = await attendee.pair(this.slug, { friendCode });
		this.#upsertPairing(pairing);
	}

	async accept(id: string) {
		const { pairing } = await attendee.acceptPairing(id);
		this.#upsertPairing(pairing);
	}

	async removePairing(id: string) {
		await attendee.deletePairing(id);
		this.ctx.pairings = this.ctx.pairings.filter((p) => p.id !== id);
	}

	async setCodename(codename: string) {
		if (!this.ctx.team) return;
		const { team } = await attendee.setCodename(this.ctx.team.id, { codename });
		this.ctx.team = team;
	}

	async post(body: string) {
		const { message } = await attendee.postMessage(this.slug, { body });
		this.#addMessage(message);
	}

	#applySnapshot(s: LiveSnapshotDTO) {
		this.ctx.event = s.event;
		if (s.blueprint) this.ctx.blueprint = s.blueprint;
		this.participantCount = s.participantCount;
		this.messages = s.messages.filter((m) => !m.hidden).slice(-FEED_LIMIT);
		const mine = this.ctx.team && s.teams.find((t) => t.id === this.ctx.team!.id);
		if (mine) this.ctx.team = mine;
	}

	#addMessage(m: MessageDTO) {
		if (m.hidden || this.messages.some((x) => x.id === m.id)) return;
		this.messages = [...this.messages, m].slice(-FEED_LIMIT);
	}

	#upsertPairing(p: PairingDTO, removed = false) {
		const others = this.ctx.pairings.filter((x) => x.id !== p.id);
		this.ctx.pairings = removed ? others : [...others, p];
	}
}
