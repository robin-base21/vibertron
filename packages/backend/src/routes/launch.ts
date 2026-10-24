import { LaunchBody, LaunchPreviewBody, assignTeams, totalStations, unconfirmedSegments, type LaunchPreviewDTO } from 'common';
import { and, eq, lte } from 'drizzle-orm';
import type { App, Routes } from '../app';
import { requireEventManager, type Event } from '../auth/guards';
import { events, pairings, participants, teamMembers, teams } from '../db/schema';
import { eventDTO, liveSnapshot, loadBlueprint, teamDTOs } from '../dto';
import { HttpError, conflict, json, parseBody } from '../http';
import { notifyEvent, notifyParticipants } from '../live/notify';

function assignmentInput(app: App, event: Event) {
	const participantIds = app.db.select({ id: participants.id }).from(participants).where(eq(participants.eventId, event.id)).all().map((r) => r.id);
	const pairs = app.db
		.select({ from: pairings.fromParticipantId, to: pairings.toParticipantId })
		.from(pairings)
		.where(and(eq(pairings.eventId, event.id), eq(pairings.accepted, true)))
		.all()
		.map((p): [string, string] => [p.from, p.to]);
	return { participantIds, pairs, blueprint: loadBlueprint(app.db, event.id).blueprint };
}

/** Marks live events past endsAt as ended. Returns how many were ended. */
export function endExpiredEvents(app: App, now = new Date()): number {
	const expired = app.db
		.update(events)
		.set({ status: 'ended' })
		.where(and(eq(events.status, 'live'), lte(events.endsAt, now)))
		.returning()
		.all();
	for (const e of expired) notifyEvent(app, e);
	return expired.length;
}

export function launchRoutes(app: App): Routes {
	const { db } = app;

	return {
		'/api/events/:id/launch/preview': {
			POST: async (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const { teamSize } = await parseBody(req, LaunchPreviewBody);
				const { participantIds, pairs, blueprint } = assignmentInput(app, event);
				const n = participantIds.length;
				const preview: LaunchPreviewDTO = {
					ok: false,
					participants: n,
					teams: n ? Math.ceil(n / teamSize) : 0,
					stationsAvailable: blueprint ? totalStations(blueprint) : 0,
					unconfirmedSegments: blueprint ? unconfirmedSegments(blueprint).map((s) => s.name) : []
				};
				if (event.status !== 'open') preview.message = `Event must be open to launch (it is ${event.status})`;
				else if (!blueprint) preview.message = 'Save a blueprint first';
				else {
					const result = assignTeams({ participantIds, pairs, teamSize, blueprint, seed: 1 });
					if (result.ok) preview.ok = true;
					else preview.message = result.message;
				}
				return json(preview);
			}
		},
		'/api/events/:id/launch': {
			POST: async (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const body = await parseBody(req, LaunchBody);
				if (event.status !== 'open') throw conflict(`Event must be open to launch (it is ${event.status})`);
				const { participantIds, pairs, blueprint } = assignmentInput(app, event);
				if (!blueprint) throw conflict('Save a blueprint first');
				const seed = body.seed ?? Math.floor(Math.random() * 2 ** 31);
				const result = assignTeams({ participantIds, pairs, teamSize: body.teamSize, blueprint, seed });
				if (!result.ok) {
					throw result.error === 'capacity'
						? new HttpError(409, 'capacity', result.message, { needed: result.needed, available: result.available })
						: new HttpError(409, 'invalid', result.message);
				}

				const now = Date.now();
				const updated = db.transaction((tx) => {
					// Guard against a concurrent launch: only one request flips open -> live.
					const flipped = tx
						.update(events)
						.set({
							status: 'live',
							startedAt: new Date(now),
							endsAt: new Date(now + body.durationMin * 60_000),
							teamSize: body.teamSize,
							durationMin: body.durationMin,
							seed
						})
						.where(and(eq(events.id, event.id), eq(events.status, 'open')))
						.returning()
						.get();
					if (!flipped) throw conflict('Event was launched concurrently');
					tx.delete(teams).where(eq(teams.eventId, event.id)).run();
					for (const t of result.teams) {
						const teamId = crypto.randomUUID();
						tx.insert(teams)
							.values({ id: teamId, eventId: event.id, name: t.name, segmentId: t.segmentId, stationIds: JSON.stringify(t.stationIds), position: t.index })
							.run();
						tx.insert(teamMembers)
							.values(t.memberIds.map((participantId, i) => ({ teamId, participantId, stationId: t.stationIds[i]! })))
							.run();
					}
					return flipped;
				});

				const teamList = teamDTOs(db, event.id);
				app.live.toEvent(event.id, { type: 'launched', snapshot: liveSnapshot(db, updated, false) });
				notifyEvent(app, updated);
				notifyParticipants(app, event.id);
				const userOf = new Map(
					db
						.select({ id: participants.id, userId: participants.userId })
						.from(participants)
						.where(eq(participants.eventId, event.id))
						.all()
						.map((p) => [p.id, p.userId])
				);
				for (const team of teamList) {
					for (const m of team.members) {
						const userId = userOf.get(m.participantId);
						if (userId) app.live.toUser(userId, { type: 'assignment', eventId: event.id, team, stationId: m.stationId });
					}
				}
				return json({ event: eventDTO(db, updated), teams: teamList });
			}
		},
		'/api/events/:id/end': {
			POST: (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				if (event.status !== 'live') throw conflict(`Only live events can be ended (it is ${event.status})`);
				const now = new Date();
				const endsAt = event.endsAt && event.endsAt < now ? event.endsAt : now;
				const updated = db.update(events).set({ status: 'ended', endsAt }).where(eq(events.id, event.id)).returning().get()!;
				notifyEvent(app, updated);
				return json({ event: eventDTO(db, updated) });
			}
		}
	};
}
