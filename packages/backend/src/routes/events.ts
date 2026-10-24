import { CreateEventBody, UpdateEventBody, type PairingDTO } from 'common';
import { desc, eq, or } from 'drizzle-orm';
import type { App, Routes } from '../app';
import { requireEventManager, requireRole } from '../auth/guards';
import { randomToken } from '../auth/session';
import { events, pairings, participants } from '../db/schema';
import { eventDTO, pairingDTO, participantDTOs } from '../dto';
import { conflict, json, notFound, parseBody } from '../http';
import { notifyEvent, notifyPairing, notifyParticipants } from '../live/notify';

export function slugify(name: string): string {
	const base = name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32)
		.replace(/-+$/, '');
	return base.length >= 3 ? base : `event${base ? `-${base}` : ''}`;
}

export function eventRoutes(app: App): Routes {
	const { db } = app;
	const slugTaken = (slug: string) => !!db.select({ id: events.id }).from(events).where(eq(events.slug, slug)).get();

	const uniqueSlug = (name: string) => {
		const base = slugify(name);
		if (!slugTaken(base)) return base;
		for (let i = 2; i < 100; i++) {
			const s = `${base}-${i}`;
			if (!slugTaken(s)) return s;
		}
		return `${base}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
	};

	return {
		'/api/events': {
			GET: (req) => {
				const user = requireRole(app, req, 'manager');
				const q = db.select().from(events);
				const rows = (user.role === 'admin' ? q : q.where(eq(events.managerId, user.id))).orderBy(desc(events.createdAt)).all();
				return json({ events: rows.map((e) => eventDTO(db, e)) });
			},
			POST: async (req) => {
				const user = requireRole(app, req, 'manager');
				const body = await parseBody(req, CreateEventBody);
				if (body.slug && slugTaken(body.slug)) throw conflict('Slug already in use');
				const event = db
					.insert(events)
					.values({
						id: crypto.randomUUID(),
						managerId: user.id,
						name: body.name,
						slug: body.slug ?? uniqueSlug(body.name),
						joinSecret: randomToken(32)
					})
					.returning()
					.get();
				return json({ event: eventDTO(db, event) }, { status: 201 });
			}
		},
		'/api/events/:id': {
			GET: (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				return json({ event: eventDTO(db, event) });
			},
			PATCH: async (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const body = await parseBody(req, UpdateEventBody);
				if (body.status && event.status !== body.status && !['draft', 'open'].includes(event.status)) {
					throw conflict(`Event is ${event.status}; status can only change between draft and open`);
				}
				const patch: Partial<typeof events.$inferInsert> = {};
				if (body.name) patch.name = body.name;
				if (body.status) patch.status = body.status;
				const updated = Object.keys(patch).length ? db.update(events).set(patch).where(eq(events.id, event.id)).returning().get()! : event;
				notifyEvent(app, updated);
				return json({ event: eventDTO(db, updated) });
			},
			DELETE: (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				db.delete(events).where(eq(events.id, event.id)).run();
				return json({ ok: true });
			}
		},
		'/api/events/:id/participants': {
			GET: (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				return json({ participants: participantDTOs(db, event.id) });
			}
		},
		'/api/events/:id/participants/:pid': {
			DELETE: (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				if (event.status === 'live') throw conflict('Cannot remove participants while the event is live');
				const p = db.select().from(participants).where(eq(participants.id, req.params.pid!)).get();
				if (!p || p.eventId !== event.id) throw notFound('Participant not found');
				const affected = db
					.select({ id: pairings.id })
					.from(pairings)
					.where(or(eq(pairings.fromParticipantId, p.id), eq(pairings.toParticipantId, p.id)))
					.all()
					.map((r) => pairingDTO(db, r.id))
					.filter((d): d is PairingDTO => !!d);
				// Notify while both users are still resolvable, then delete (pairings cascade).
				for (const d of affected) notifyPairing(app, d, true);
				db.delete(participants).where(eq(participants.id, p.id)).run();
				notifyParticipants(app, event.id);
				return json({ ok: true });
			}
		}
	};
}
