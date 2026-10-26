import { attendee } from '$lib/api';
import { handleError } from '$lib/stores/toast.svelte';
import { wsStore } from '$lib/stores/websocket.svelte';
import {
	parseStationId,
	type AttendeeContextDTO,
	type LiveSnapshotDTO,
	type MessageDTO,
	type PairingDTO,
	type ProjectDTO,
	type TallyRow,
	type TeamDTO,
	type VoteRound,
	type VotingPhase,
	type VotingStateDTO
} from 'common';

const FEED_LIMIT = 50;

/** Live state of the attendee page for one event: context from `/me` kept fresh over WS. */
export class AttendeeState {
	ctx: AttendeeContextDTO = $state()!;
	/** Null until the live snapshot or a WS count arrives. */
	participantCount = $state<number | null>(null);
	messages: MessageDTO[] = $state([]);
	/** Every project of the event (public). */
	projects: ProjectDTO[] = $state([]);
	/** Every team (for codenames in the results). */
	teams: TeamDTO[] = $state([]);
	voting = $state<VotingStateDTO | null>(null);

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

	get phase(): VotingPhase {
		return this.voting?.phase ?? this.ctx.event.votingPhase ?? 'none';
	}

	get project(): ProjectDTO | null {
		return this.ctx.project;
	}

	/** Projects of the attendee's own team. */
	get teamProjects(): ProjectDTO[] {
		const teamId = this.ctx.team?.id;
		return teamId ? this.projects.filter((p) => p.teamId === teamId) : [];
	}

	/** Project ids to rank in `round`: all of them, own included; none when there is only one. */
	candidates(round: VoteRound): string[] {
		const pool = round === 'group' ? this.teamProjects : (this.voting?.pitches ?? []);
		return pool.length < 2 ? [] : pool.map((p) => p.id);
	}

	projectById(id: string): ProjectDTO | undefined {
		return this.projects.find((p) => p.id === id) ?? this.voting?.pitches.find((p) => p.id === id);
	}

	#team(teamId: string) {
		return this.teams.find((x) => x.id === teamId) ?? (this.ctx.team?.id === teamId ? this.ctx.team : null);
	}

	teamName(teamId: string): string {
		const t = this.#team(teamId);
		return t?.codename ?? t?.name ?? '';
	}

	/** Launch position (for the team colour), null for an unknown team. */
	teamPosition(teamId: string): number | null {
		return this.#team(teamId)?.position ?? null;
	}

	/** Group-round progress of the attendee's team. */
	get teamProgress() {
		return this.voting?.group.perTeam.find((t) => t.teamId === this.ctx.team?.id) ?? null;
	}

	/** Final placing of the attendee's project: in the pitch round if it pitched, else in its team. */
	get myResult(): { round: VoteRound; row: TallyRow; of: number } | null {
		const results = this.voting?.results;
		const id = this.ctx.project?.id;
		if (!results || !id) return null;
		const pitch = results.pitch.find((r) => r.projectId === id);
		if (pitch) return { round: 'pitch', row: pitch, of: results.pitch.length };
		const group = this.ctx.team ? results.group[this.ctx.team.id] : undefined;
		const row = group?.find((r) => r.projectId === id);
		return row && group ? { round: 'group', row, of: group.length } : null;
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
				const i = this.teams.findIndex((t) => t.id === e.team.id);
				if (i !== -1) this.teams[i] = e.team;
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
			}),
			wsStore.on('project.updated', (e) => {
				if (e.project.eventId === eventId) this.#upsertProject(e.project);
			}),
			wsStore.on('voting.updated', (e) => {
				if (e.eventId !== eventId) return;
				const reset = e.voting.phase === 'none' && this.phase !== 'none';
				this.voting = e.voting;
				this.ctx.event = { ...this.ctx.event, votingPhase: e.voting.phase };
				if (reset) this.ctx.ballots = {};
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

	async saveProject(name: string, tagline: string) {
		const { project } = await attendee.saveProject(this.slug, {
			name,
			tagline: tagline.trim() || undefined
		});
		this.#upsertProject(project);
	}

	async saveBallot(round: VoteRound, ranking: string[]) {
		const res = await attendee.saveBallot(this.slug, { round, ranking });
		this.voting = res.voting;
		this.ctx.ballots = { ...this.ctx.ballots, [round]: [...ranking] };
	}

	#upsertProject(p: ProjectDTO) {
		const i = this.projects.findIndex((x) => x.id === p.id);
		if (i === -1) this.projects.push(p);
		else this.projects[i] = p;
		if (p.participantId === this.me.id) this.ctx.project = p;
	}

	#applySnapshot(s: LiveSnapshotDTO) {
		this.ctx.event = s.event;
		this.projects = s.projects ?? [];
		this.teams = s.teams;
		if (s.voting) this.voting = s.voting;
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
