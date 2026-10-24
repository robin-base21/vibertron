import { CodenameBody, MessageBody, ModerateBody } from 'common';
import { and, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { App, Routes } from '../app';
import { canManage, requireEventManager, requireUser } from '../auth/guards';
import { getSessionUser } from '../auth/session';
import { events, messages, participants, teamMembers, teams } from '../db/schema';
import { liveSnapshot, messageDTO, teamDTO } from '../dto';
import { HttpError, conflict, forbidden, json, notFound, parseBody } from '../http';
import { loadEventBySlug, requireParticipant } from './attendee';

export function liveRoutes(app: App): Routes {
	const { db } = app;

	return {
		'/api/teams/:id': {
			PATCH: async (req) => {
				const user = requireUser(app, req);
				const body = await parseBody(req, CodenameBody);
				const team = db.select().from(teams).where(eq(teams.id, req.params.id!)).get();
				if (!team) throw notFound('Team not found');
				const member = db
					.select({ pid: teamMembers.participantId })
					.from(teamMembers)
					.innerJoin(participants, eq(participants.id, teamMembers.participantId))
					.where(and(eq(teamMembers.teamId, team.id), eq(participants.userId, user.id)))
					.get();
				if (!member) throw forbidden('Only team members can set the codename');
				const event = db.select().from(events).where(eq(events.id, team.eventId)).get()!;
				if (event.status !== 'live') throw conflict('Codenames can only be set while the event is live');
				const clash = db
					.select({ id: teams.id })
					.from(teams)
					.where(and(eq(teams.eventId, event.id), ne(teams.id, team.id), sql`lower(${teams.codename}) = lower(${body.codename})`))
					.get();
				if (clash) throw conflict('Another team already uses that codename');
				db.update(teams).set({ codename: body.codename }).where(eq(teams.id, team.id)).run();
				const dto = teamDTO(db, team.id)!;
				app.live.toEvent(event.id, { type: 'team.updated', team: dto });
				return json({ team: dto });
			}
		},
		'/api/e/:slug/messages': {
			POST: async (req) => {
				const { event, participant } = requireParticipant(app, req, req.params.slug!);
				const body = await parseBody(req, MessageBody);
				if (event.status !== 'live') throw conflict('Messages are only open while the event is live');
				const team = db
					.select({ id: teams.id, codename: teams.codename })
					.from(teamMembers)
					.innerJoin(teams, eq(teams.id, teamMembers.teamId))
					.where(eq(teamMembers.participantId, participant.id))
					.get();
				if (!team) throw forbidden('You are not on a team');
				if (!team.codename) throw new HttpError(409, 'codename_required', 'Set a team codename before posting');

				const now = Date.now();
				const limit = app.env.messageRateLimitMs;
				// Atomic check-and-set of the per-participant rate limit.
				const allowed = db
					.update(participants)
					.set({ lastMessageAt: new Date(now) })
					.where(and(eq(participants.id, participant.id), or(isNull(participants.lastMessageAt), lte(participants.lastMessageAt, new Date(now - limit)))))
					.returning({ id: participants.id })
					.get();
				if (!allowed) {
					const last = db.select({ t: participants.lastMessageAt }).from(participants).where(eq(participants.id, participant.id)).get()?.t?.getTime() ?? now;
					const retryAfterMs = Math.max(0, last + limit - now);
					throw new HttpError(429, 'rate_limited', 'You are posting too fast', { retryAfterMs });
				}
				const id = crypto.randomUUID();
				db.insert(messages).values({ id, eventId: event.id, teamId: team.id, participantId: participant.id, body: body.body, createdAt: new Date(now) }).run();
				const dto = messageDTO(db, id)!;
				app.live.toEvent(event.id, { type: 'message.created', message: dto });
				return json({ message: dto }, { status: 201 });
			}
		},
		'/api/messages/:id': {
			PATCH: async (req) => {
				const msg = db.select().from(messages).where(eq(messages.id, req.params.id!)).get();
				if (!msg) {
					requireUser(app, req);
					throw notFound('Message not found');
				}
				requireEventManager(app, req, msg.eventId);
				const body = await parseBody(req, ModerateBody);
				db.update(messages).set({ hidden: body.hidden }).where(eq(messages.id, msg.id)).run();
				const dto = messageDTO(db, msg.id)!;
				app.live.toEvent(msg.eventId, { type: 'message.hidden', messageId: msg.id, hidden: body.hidden });
				app.live.toManagers(msg.eventId, { type: 'message.manage', message: dto });
				return json({ message: dto });
			}
		},
		'/api/e/:slug/live': {
			GET: (req) => {
				const event = loadEventBySlug(app, req.params.slug!);
				return json(liveSnapshot(db, event, canManage(getSessionUser(db, req), event)));
			}
		}
	};
}
