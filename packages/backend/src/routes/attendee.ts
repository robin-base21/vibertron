import { PairBody, pairGroups, type AttendeeContextDTO } from 'common';
import { and, eq, or } from 'drizzle-orm';
import type { App, Routes } from '../app';
import { canManage, requireUser, type Event } from '../auth/guards';
import type { User } from '../auth/session';
import { events, pairings, participants, teamMembers } from '../db/schema';
import { ballotsFor, loadBlueprint, pairingDTO, pairingsForParticipant, participantDTO, projectForParticipant, publicEventDTO, teamDTO } from '../dto';
import { badRequest, conflict, forbidden, json, notFound, parseBody } from '../http';
import { notifyPairing } from '../live/notify';

export const DEFAULT_GROUP_LIMIT = 4;

type Participant = typeof participants.$inferSelect;

export function loadEventBySlug(app: App, slug: string): Event {
	const event = app.db.select().from(events).where(eq(events.slug, slug)).get();
	if (!event) throw notFound('Event not found');
	return event;
}

export function requireParticipant(app: App, req: Request, slug: string): { user: User; event: Event; participant: Participant } {
	const user = requireUser(app, req);
	const event = loadEventBySlug(app, slug);
	const participant = app.db
		.select()
		.from(participants)
		.where(and(eq(participants.eventId, event.id), eq(participants.userId, user.id)))
		.get();
	if (!participant) throw forbidden('Not a participant of this event');
	return { user, event, participant };
}

export function attendeeRoutes(app: App): Routes {
	const { db } = app;

	/** Size of the friend group that would result from linking a and b (accepted pairings only). */
	const mergedGroupSize = (eventId: string, a: string, b: string) => {
		const ids = db.select({ id: participants.id }).from(participants).where(eq(participants.eventId, eventId)).all().map((r) => r.id);
		const accepted = db
			.select({ from: pairings.fromParticipantId, to: pairings.toParticipantId })
			.from(pairings)
			.where(and(eq(pairings.eventId, eventId), eq(pairings.accepted, true)))
			.all()
			.map((p): [string, string] => [p.from, p.to]);
		const groups = pairGroups(ids, [...accepted, [a, b]]);
		return groups.find((g) => g.includes(a))?.length ?? 2;
	};

	const assertGroupFits = (event: Event, a: string, b: string) => {
		const limit = event.teamSize ?? DEFAULT_GROUP_LIMIT;
		const size = mergedGroupSize(event.id, a, b);
		if (size > limit) throw conflict(`Friend group would have ${size} people; the limit is ${limit}`);
	};

	const assertPrelaunch = (event: Event) => {
		if (event.status === 'live' || event.status === 'ended') throw conflict('Pairing is closed once the event has launched');
	};

	const loadPairing = (id: string) => {
		const pairing = db.select().from(pairings).where(eq(pairings.id, id)).get();
		if (!pairing) throw notFound('Pairing not found');
		const event = db.select().from(events).where(eq(events.id, pairing.eventId)).get()!;
		const ends = db
			.select()
			.from(participants)
			.where(or(eq(participants.id, pairing.fromParticipantId), eq(participants.id, pairing.toParticipantId)))
			.all();
		return {
			pairing,
			event,
			from: ends.find((p) => p.id === pairing.fromParticipantId)!,
			to: ends.find((p) => p.id === pairing.toParticipantId)!
		};
	};

	return {
		'/api/e/:slug/me': {
			GET: (req) => {
				const { event, participant } = requireParticipant(app, req, req.params.slug!);
				const member = db.select().from(teamMembers).where(eq(teamMembers.participantId, participant.id)).get();
				const ctx: AttendeeContextDTO = {
					event: publicEventDTO(event),
					participant: participantDTO(db, participant.id)!,
					pairings: pairingsForParticipant(db, participant.id),
					team: member ? teamDTO(db, member.teamId) : null,
					stationId: member?.stationId ?? null,
					blueprint: loadBlueprint(db, event.id).blueprint,
					project: projectForParticipant(db, participant.id),
					ballots: ballotsFor(db, participant.id)
				};
				return json(ctx);
			}
		},
		'/api/e/:slug/pairings': {
			POST: async (req) => {
				const { event, participant } = requireParticipant(app, req, req.params.slug!);
				const body = await parseBody(req, PairBody);
				assertPrelaunch(event);
				const target = db
					.select()
					.from(participants)
					.where(and(eq(participants.eventId, event.id), eq(participants.friendCode, body.friendCode)))
					.get();
				if (!target) throw notFound('No participant with that friend code');
				if (target.id === participant.id) throw badRequest('You cannot pair with yourself');
				const existing = db
					.select({ id: pairings.id })
					.from(pairings)
					.where(
						or(
							and(eq(pairings.fromParticipantId, participant.id), eq(pairings.toParticipantId, target.id)),
							and(eq(pairings.fromParticipantId, target.id), eq(pairings.toParticipantId, participant.id))
						)
					)
					.get();
				if (existing) throw conflict('A pairing between you already exists', { pairingId: existing.id });
				assertGroupFits(event, participant.id, target.id);
				const id = crypto.randomUUID();
				db.insert(pairings).values({ id, eventId: event.id, fromParticipantId: participant.id, toParticipantId: target.id }).run();
				const dto = pairingDTO(db, id)!;
				notifyPairing(app, dto);
				return json({ pairing: dto }, { status: 201 });
			}
		},
		'/api/pairings/:id/accept': {
			POST: (req) => {
				const user = requireUser(app, req);
				const { pairing, event, to } = loadPairing(req.params.id!);
				if (to.userId !== user.id) throw forbidden('Only the recipient can accept');
				assertPrelaunch(event);
				if (!pairing.accepted) {
					assertGroupFits(event, pairing.fromParticipantId, pairing.toParticipantId);
					db.update(pairings).set({ accepted: true }).where(eq(pairings.id, pairing.id)).run();
				}
				const dto = pairingDTO(db, pairing.id)!;
				notifyPairing(app, dto);
				return json({ pairing: dto });
			}
		},
		'/api/pairings/:id': {
			DELETE: (req) => {
				const user = requireUser(app, req);
				const { pairing, event, from, to } = loadPairing(req.params.id!);
				if (from.userId !== user.id && to.userId !== user.id && !canManage(user, event)) throw forbidden();
				assertPrelaunch(event);
				const dto = pairingDTO(db, pairing.id)!;
				db.delete(pairings).where(eq(pairings.id, pairing.id)).run();
				notifyPairing(app, dto, true);
				return json({ ok: true });
			}
		}
	};
}
