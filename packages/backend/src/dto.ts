import {
	Blueprint,
	type EventDTO,
	type LiveSnapshotDTO,
	type MessageDTO,
	type PairingDTO,
	type ParticipantDTO,
	type PublicEventDTO,
	type TeamDTO,
	type UserDTO
} from 'common';
import { and, asc, count, desc, eq, inArray, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Event } from './auth/guards';
import type { User } from './auth/session';
import type { DB } from './db';
import { blueprints, messages, pairings, participants, teamMembers, teams, users } from './db/schema';

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
		endsAt: ms(e.endsAt)
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
		serverTime: Date.now()
	};
}
