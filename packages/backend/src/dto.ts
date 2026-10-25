import {
	Blueprint,
	type EventDTO,
	type LiveSnapshotDTO,
	type MessageDTO,
	type PairingDTO,
	type ParticipantDTO,
	type PublicEventDTO,
	type TeamDTO,
	type UserDTO,
	type ProjectDTO,
	type TallyRow,
	type VotingStateDTO,
	groupEligibleVoters,
	pitchEligibleVoters
} from 'common';
import { and, asc, count, desc, eq, inArray, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Event } from './auth/guards';
import type { User } from './auth/session';
import type { DB } from './db';
import { ballots, blueprints, messages, pairings, participants, projects, teamMembers, teams, users, votingResults } from './db/schema';

const ms = (d: Date | null) => (d ? d.getTime() : null);

export function userDTO(u: User): UserDTO {
	return { id: u.id, role: u.role, email: u.email, displayName: u.displayName, createdAt: u.createdAt.getTime() };
}

export function publicEventDTO(e: Event): PublicEventDTO {
	return {
		id: e.id,
		slug: e.slug,
		name: e.name,
		status: e.status,
		teamSize: e.teamSize,
		durationMin: e.durationMin,
		startedAt: ms(e.startedAt),
		endsAt: ms(e.endsAt),
		votingPhase: e.votingPhase
	};
}

export function participantCount(db: DB, eventId: string): number {
	return db.select({ n: count() }).from(participants).where(eq(participants.eventId, eventId)).get()?.n ?? 0;
}

export function eventDTO(db: DB, e: Event): EventDTO {
	return { ...publicEventDTO(e), managerId: e.managerId, participantCount: participantCount(db, e.id), createdAt: e.createdAt.getTime() };
}

function participantQuery(db: DB) {
	return db
		.select({
			id: participants.id,
			eventId: participants.eventId,
			userId: participants.userId,
			displayName: users.displayName,
			friendCode: participants.friendCode,
			teamId: teamMembers.teamId,
			joinedAt: participants.joinedAt
		})
		.from(participants)
		.innerJoin(users, eq(users.id, participants.userId))
		.leftJoin(teamMembers, eq(teamMembers.participantId, participants.id));
}

type ParticipantRow = Awaited<ReturnType<ReturnType<typeof participantQuery>['all']>>[number];
const toParticipantDTO = (r: ParticipantRow): ParticipantDTO => ({ ...r, teamId: r.teamId ?? null, joinedAt: r.joinedAt.getTime() });

export function participantDTOs(db: DB, eventId: string): ParticipantDTO[] {
	return participantQuery(db).where(eq(participants.eventId, eventId)).orderBy(asc(participants.joinedAt)).all().map(toParticipantDTO);
}

export function participantDTO(db: DB, participantId: string): ParticipantDTO | null {
	const r = participantQuery(db).where(eq(participants.id, participantId)).get();
	return r ? toParticipantDTO(r) : null;
}

const fromP = alias(participants, 'from_p');
const toP = alias(participants, 'to_p');
const fromU = alias(users, 'from_u');
const toU = alias(users, 'to_u');

function pairingQuery(db: DB) {
	return db
		.select({
			id: pairings.id,
			fromParticipantId: pairings.fromParticipantId,
			fromName: fromU.displayName,
			toParticipantId: pairings.toParticipantId,
			toName: toU.displayName,
			accepted: pairings.accepted
		})
		.from(pairings)
		.innerJoin(fromP, eq(fromP.id, pairings.fromParticipantId))
		.innerJoin(fromU, eq(fromU.id, fromP.userId))
		.innerJoin(toP, eq(toP.id, pairings.toParticipantId))
		.innerJoin(toU, eq(toU.id, toP.userId));
}

export function pairingDTO(db: DB, pairingId: string): PairingDTO | null {
	return pairingQuery(db).where(eq(pairings.id, pairingId)).get() ?? null;
}

export function pairingsForParticipant(db: DB, participantId: string): PairingDTO[] {
	return pairingQuery(db)
		.where(or(eq(pairings.fromParticipantId, participantId), eq(pairings.toParticipantId, participantId)))
		.orderBy(asc(pairings.createdAt))
		.all();
}

function teamsToDTO(db: DB, rows: (typeof teams.$inferSelect)[]): TeamDTO[] {
	if (rows.length === 0) return [];
	const members = db
		.select({ teamId: teamMembers.teamId, participantId: teamMembers.participantId, stationId: teamMembers.stationId, displayName: users.displayName })
		.from(teamMembers)
		.innerJoin(participants, eq(participants.id, teamMembers.participantId))
		.innerJoin(users, eq(users.id, participants.userId))
		.where(
			inArray(
				teamMembers.teamId,
				rows.map((t) => t.id)
			)
		)
		.orderBy(asc(teamMembers.stationId))
		.all();
	return rows.map((t) => ({
		id: t.id,
		eventId: t.eventId,
		name: t.name,
		codename: t.codename,
		segmentId: t.segmentId,
		members: members.filter((m) => m.teamId === t.id).map(({ participantId, displayName, stationId }) => ({ participantId, displayName, stationId }))
	}));
}

export function teamDTOs(db: DB, eventId: string): TeamDTO[] {
	return teamsToDTO(db, db.select().from(teams).where(eq(teams.eventId, eventId)).orderBy(asc(teams.position)).all());
}

export function teamDTO(db: DB, teamId: string): TeamDTO | null {
	return teamsToDTO(db, db.select().from(teams).where(eq(teams.id, teamId)).all())[0] ?? null;
}

function messageQuery(db: DB) {
	return db
		.select({
			id: messages.id,
			eventId: messages.eventId,
			teamId: messages.teamId,
			codename: teams.codename,
			authorName: users.displayName,
			body: messages.body,
			hidden: messages.hidden,
			createdAt: messages.createdAt
		})
		.from(messages)
		.innerJoin(teams, eq(teams.id, messages.teamId))
		.innerJoin(participants, eq(participants.id, messages.participantId))
		.innerJoin(users, eq(users.id, participants.userId));
}

type MessageRow = Awaited<ReturnType<ReturnType<typeof messageQuery>['all']>>[number];
const toMessageDTO = (r: MessageRow): MessageDTO => ({ ...r, codename: r.codename ?? '', createdAt: r.createdAt.getTime() });

export function messageDTO(db: DB, messageId: string): MessageDTO | null {
	const r = messageQuery(db).where(eq(messages.id, messageId)).get();
	return r ? toMessageDTO(r) : null;
}

export function recentMessages(db: DB, eventId: string, includeHidden: boolean, limit = 50): MessageDTO[] {
	const where = includeHidden ? eq(messages.eventId, eventId) : and(eq(messages.eventId, eventId), eq(messages.hidden, false));
	return messageQuery(db).where(where).orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit).all().map(toMessageDTO).reverse();
}

export function loadBlueprint(db: DB, eventId: string): { blueprint: Blueprint | null; version: number } {
	const row = db.select().from(blueprints).where(eq(blueprints.eventId, eventId)).get();
	if (!row) return { blueprint: null, version: 0 };
	const parsed = Blueprint.safeParse(JSON.parse(row.json));
	return { blueprint: parsed.success ? parsed.data : null, version: row.version };
}

export function liveSnapshot(db: DB, event: Event, includeHidden: boolean): LiveSnapshotDTO {
	return {
		event: publicEventDTO(event),
		blueprint: loadBlueprint(db, event.id).blueprint,
		teams: teamDTOs(db, event.id),
		messages: recentMessages(db, event.id, includeHidden),
		participantCount: participantCount(db, event.id),
		projects: projectDTOs(db, event.id),
		voting: votingState(db, event),
		serverTime: Date.now()
	};
}

// ---------- Voting (Phase 6) ----------

function projectQuery(db: DB) {
	return db
		.select({
			id: projects.id,
			eventId: projects.eventId,
			teamId: projects.teamId,
			participantId: projects.participantId,
			authorName: users.displayName,
			name: projects.name,
			tagline: projects.tagline
		})
		.from(projects)
		.innerJoin(participants, eq(participants.id, projects.participantId))
		.innerJoin(users, eq(users.id, participants.userId))
		.leftJoin(teams, eq(teams.id, projects.teamId));
}

/** Projects of an event in team order, then by author name. */
export function projectDTOs(db: DB, eventId: string): ProjectDTO[] {
	return projectQuery(db).where(eq(projects.eventId, eventId)).orderBy(asc(teams.position), asc(users.displayName)).all();
}

export function projectDTO(db: DB, projectId: string): ProjectDTO | null {
	return projectQuery(db).where(eq(projects.id, projectId)).get() ?? null;
}

export function projectForParticipant(db: DB, participantId: string): ProjectDTO | null {
	return projectQuery(db).where(eq(projects.participantId, participantId)).get() ?? null;
}

/** Frozen group-round result: per-team tallies and the pitching project ids in team order. */
export interface GroupResult {
	teams: Record<string, TallyRow[]>;
	pitches: string[];
}

export function loadResult(db: DB, eventId: string, round: 'group'): GroupResult | null;
export function loadResult(db: DB, eventId: string, round: 'pitch'): TallyRow[] | null;
export function loadResult(db: DB, eventId: string, round: 'group' | 'pitch'): GroupResult | TallyRow[] | null {
	const row = db
		.select({ json: votingResults.json })
		.from(votingResults)
		.where(and(eq(votingResults.eventId, eventId), eq(votingResults.round, round)))
		.get();
	return row ? JSON.parse(row.json) : null;
}

/** Team members (participant ids) per team, teams in position order. */
export function teamRosters(db: DB, eventId: string): { teamId: string; memberIds: string[] }[] {
	const teamRows = db.select({ id: teams.id }).from(teams).where(eq(teams.eventId, eventId)).orderBy(asc(teams.position)).all();
	if (teamRows.length === 0) return [];
	const members = db
		.select({ teamId: teamMembers.teamId, participantId: teamMembers.participantId })
		.from(teamMembers)
		.where(
			inArray(
				teamMembers.teamId,
				teamRows.map((t) => t.id)
			)
		)
		.all();
	return teamRows.map((t) => ({ teamId: t.id, memberIds: members.filter((m) => m.teamId === t.id).map((m) => m.participantId) }));
}

/** Pitching projects (team order) once the group round is closed; otherwise empty. */
export function pitchProjects(db: DB, eventId: string, all: ProjectDTO[] = projectDTOs(db, eventId)): ProjectDTO[] {
	const group = loadResult(db, eventId, 'group');
	if (!group) return [];
	const byId = new Map(all.map((p) => [p.id, p]));
	return group.pitches.map((id) => byId.get(id)).filter((p): p is ProjectDTO => !!p);
}

export function votingState(db: DB, event: Event): VotingStateDTO {
	const all = projectDTOs(db, event.id);
	const rosters = teamRosters(db, event.id);
	const cast = db
		.select({ round: ballots.round, voter: ballots.voterParticipantId })
		.from(ballots)
		.where(eq(ballots.eventId, event.id))
		.all();
	const castBy = (round: 'group' | 'pitch') => new Set(cast.filter((b) => b.round === round).map((b) => b.voter));
	const groupCast = castBy('group');
	const pitchCast = castBy('pitch');

	const perTeam = rosters.map(({ teamId, memberIds }) => {
		const eligible = groupEligibleVoters(
			memberIds,
			all.filter((p) => p.teamId === teamId)
		);
		return { teamId, cast: eligible.filter((v) => groupCast.has(v)).length, eligible: eligible.length };
	});
	const voting = perTeam.filter((t) => t.eligible > 0);

	const pitches = event.votingPhase === 'pitch' || event.votingPhase === 'results' ? pitchProjects(db, event.id, all) : [];
	const pitchVoters = pitchEligibleVoters(
		rosters.flatMap((r) => r.memberIds),
		pitches
	);

	const state: VotingStateDTO = {
		phase: event.votingPhase,
		group: { teamsDone: voting.filter((t) => t.cast >= t.eligible).length, teamsTotal: voting.length, perTeam },
		pitch: { cast: pitchVoters.filter((v) => pitchCast.has(v)).length, eligible: pitchVoters.length },
		pitches
	};
	if (event.votingPhase === 'results') {
		state.results = { group: loadResult(db, event.id, 'group')?.teams ?? {}, pitch: loadResult(db, event.id, 'pitch') ?? [] };
	}
	return state;
}

/** The participant's saved rankings. */
export function ballotsFor(db: DB, participantId: string): { group?: string[]; pitch?: string[] } {
	const out: { group?: string[]; pitch?: string[] } = {};
	for (const b of db.select().from(ballots).where(eq(ballots.voterParticipantId, participantId)).all()) out[b.round] = JSON.parse(b.ranking);
	return out;
}
