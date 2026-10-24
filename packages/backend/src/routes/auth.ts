import { LoginBody, type MeDTO } from 'common';
import { eq } from 'drizzle-orm';
import type { App, Routes } from '../app';
import { clearSessionCookie, createSession, destroySession, getSessionUser, verifyPassword } from '../auth/session';
import { events, participants, users } from '../db/schema';
import { userDTO } from '../dto';
import { HttpError, json, parseBody } from '../http';

export function authRoutes(app: App): Routes {
	return {
		'/api/auth/login': {
			POST: async (req) => {
				const body = await parseBody(req, LoginBody);
				const user = app.db.select().from(users).where(eq(users.email, body.email.toLowerCase())).get();
				const ok = user?.passwordHash ? await verifyPassword(body.password, user.passwordHash) : false;
				if (!user || !ok) throw new HttpError(401, 'invalid_credentials', 'Wrong email or password');
				const cookie = createSession(app.db, user.id, app.env.secureCookies);
				return json({ user: userDTO(user) }, { headers: { 'Set-Cookie': cookie } });
			}
		},
		'/api/auth/logout': {
			POST: (req) => {
				destroySession(app.db, req);
				return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie(app.env.secureCookies) } });
			}
		},
		'/api/auth/me': {
			GET: (req) => {
				const user = getSessionUser(app.db, req);
				const me: MeDTO = { user: user ? userDTO(user) : null, participations: [] };
				if (user) {
					me.participations = app.db
						.select({ eventId: participants.eventId, slug: events.slug, participantId: participants.id })
						.from(participants)
						.innerJoin(events, eq(events.id, participants.eventId))
						.where(eq(participants.userId, user.id))
						.all();
				}
				return json(me);
			}
		}
	};
}
