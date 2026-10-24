import { CreateInviteBody, JOIN_CODE_WINDOW_MS, UpdateInviteBody, joinCodeWindow, windowStart, type InviteDTO, type JoinCodeDTO } from 'common';
import { desc, eq } from 'drizzle-orm';
import type { App, Routes } from '../app';
import { requireEventManager } from '../auth/guards';
import { randomToken } from '../auth/session';
import { invites } from '../db/schema';
import { json, notFound, parseBody } from '../http';
import { joinCodeFor } from '../joinCode';

type Invite = typeof invites.$inferSelect;

export function inviteDTO(i: Invite): InviteDTO {
	return { id: i.id, eventId: i.eventId, token: i.token, active: i.active, expiresAt: i.expiresAt?.getTime() ?? null, createdAt: i.createdAt.getTime() };
}

export function inviteRoutes(app: App): Routes {
	const { db } = app;

	const loadInvite = (req: Request, id: string) => {
		const invite = db.select().from(invites).where(eq(invites.id, id)).get();
		if (!invite) throw notFound('Invite not found');
		const { event } = requireEventManager(app, req, invite.eventId);
		return { invite, event };
	};

	return {
		'/api/events/:id/invites': {
			GET: (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				return json({ invites: db.select().from(invites).where(eq(invites.eventId, event.id)).orderBy(desc(invites.createdAt)).all().map(inviteDTO) });
			},
			POST: async (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const body = await parseBody(req, CreateInviteBody);
				const invite = db
					.insert(invites)
					.values({
						id: crypto.randomUUID(),
						eventId: event.id,
						token: randomToken(16),
						expiresAt: body.expiresAt ? new Date(body.expiresAt) : null
					})
					.returning()
					.get();
				return json({ invite: inviteDTO(invite) }, { status: 201 });
			}
		},
		'/api/invites/:id': {
			PATCH: async (req) => {
				const { invite } = loadInvite(req, req.params.id!);
				const body = await parseBody(req, UpdateInviteBody);
				const updated = db.update(invites).set({ active: body.active }).where(eq(invites.id, invite.id)).returning().get()!;
				return json({ invite: inviteDTO(updated) });
			}
		},
		'/api/invites/:id/code': {
			GET: (req) => {
				const { invite, event } = loadInvite(req, req.params.id!);
				const now = Date.now();
				const w = joinCodeWindow(now);
				const code = joinCodeFor(event.joinSecret, w);
				const dto: JoinCodeDTO = {
					code,
					joinPath: `/join/${invite.token}?c=${code}`,
					windowStart: windowStart(w),
					windowMs: JOIN_CODE_WINDOW_MS,
					serverTime: now
				};
				return json(dto);
			}
		}
	};
}
