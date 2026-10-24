import { JOIN_CODE_ALPHABET, JoinBody } from 'common';
import { and, eq } from 'drizzle-orm';
import type { App, Routes } from '../app';
import { createSession, getSessionUser } from '../auth/session';
import type { DB } from '../db';
import { events, invites, participants, users } from '../db/schema';
import { participantDTO, publicEventDTO, userDTO } from '../dto';
import { HttpError, conflict, forbidden, json, notFound, parseBody } from '../http';
import { verifyJoinCode } from '../joinCode';
import { notifyParticipants } from '../live/notify';

export const FRIEND_CODE_LENGTH = 6;

export function newFriendCode(db: DB, eventId: string): string {
	for (;;) {
		const bytes = crypto.getRandomValues(new Uint8Array(FRIEND_CODE_LENGTH));
		const code = Array.from(bytes, (b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join('');
		const taken = db
			.select({ id: participants.id })
			.from(participants)
			.where(and(eq(participants.eventId, eventId), eq(participants.friendCode, code)))
			.get();
		if (!taken) return code;
	}
}

export function joinRoutes(app: App): Routes {
	const { db } = app;

	/** Valid (active, unexpired) invite + its event; 404 unknown, 410 inactive/expired. */
	const loadInvite = (token: string) => {
		const row = db.select({ invite: invites, event: events }).from(invites).innerJoin(events, eq(events.id, invites.eventId)).where(eq(invites.token, token)).get();
		if (!row) throw notFound('Invite not found');
		if (!row.invite.active || (row.invite.expiresAt && row.invite.expiresAt.getTime() < Date.now())) {
			throw new HttpError(410, 'invite_expired', 'This invite is no longer valid');
		}
		return row;
	};

	return {
		'/api/join/:token': {
			GET: (req) => {
				const { event } = loadInvite(req.params.token!);
				return json({ event: publicEventDTO(event) });
			},
			POST: async (req) => {
				const { event } = loadInvite(req.params.token!);
				const body = await parseBody(req, JoinBody);
				let user = getSessionUser(db, req);

				// Already joined: idempotent, regardless of the (possibly stale) code.
				if (user) {
					const existing = db
						.select({ id: participants.id })
						.from(participants)
						.where(and(eq(participants.eventId, event.id), eq(participants.userId, user.id)))
						.get();
					if (existing) return json({ user: userDTO(user), participant: participantDTO(db, existing.id), event: publicEventDTO(event) });
				}

				if (!verifyJoinCode(event.joinSecret, body.code)) throw forbidden('Wrong or expired code');
				if (event.status !== 'open') throw conflict(event.status === 'draft' ? 'Event is not open for joining yet' : `Event is ${event.status}`);

				const headers: Record<string, string> = {};
				const participantId = db.transaction((tx) => {
					if (!user) {
						user = tx.insert(users).values({ id: crypto.randomUUID(), role: 'attendee', displayName: body.displayName }).returning().get();
					}
					return tx
						.insert(participants)
						.values({ id: crypto.randomUUID(), eventId: event.id, userId: user.id, friendCode: newFriendCode(db, event.id) })
						.returning({ id: participants.id })
						.get().id;
				});
				if (!getSessionUser(db, req)) headers['Set-Cookie'] = createSession(db, user!.id, app.env.secureCookies);

				notifyParticipants(app, event.id);
				return json({ user: userDTO(user!), participant: participantDTO(db, participantId), event: publicEventDTO(event) }, { status: 201, headers });
			}
		}
	};
}
