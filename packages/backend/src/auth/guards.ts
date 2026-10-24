import { hasRole, type Role } from 'common';
import { eq } from 'drizzle-orm';
import type { App } from '../app';
import { events } from '../db/schema';
import { forbidden, notFound, unauthorized } from '../http';
import { getSessionUser, type User } from './session';

export type Event = typeof events.$inferSelect;

export function requireUser(app: App, req: Request): User {
	const user = getSessionUser(app.db, req);
	if (!user) throw unauthorized();
	return user;
}

export function requireRole(app: App, req: Request, role: Role): User {
	const user = requireUser(app, req);
	if (!hasRole(user.role, role)) throw forbidden();
	return user;
}

export function canManage(user: User | null, event: Event): boolean {
	return !!user && (user.role === 'admin' || (user.role === 'manager' && event.managerId === user.id));
}

/** Loads the event and checks the user is its manager (or an admin). */
export function requireEventManager(app: App, req: Request, eventId: string): { user: User; event: Event } {
	const user = requireRole(app, req, 'manager');
	const event = app.db.select().from(events).where(eq(events.id, eventId)).get();
	if (!event) throw notFound('Event not found');
	if (!canManage(user, event)) throw forbidden('Not your event');
	return { user, event };
}
