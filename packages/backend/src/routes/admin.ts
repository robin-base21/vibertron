import { CreateUserBody, UpdateUserBody } from 'common';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import type { App, Routes } from '../app';
import { requireRole } from '../auth/guards';
import { hashPassword } from '../auth/session';
import { sessions, users } from '../db/schema';
import { userDTO } from '../dto';
import { badRequest, conflict, json, notFound, parseBody } from '../http';

export function adminRoutes(app: App): Routes {
	const { db } = app;

	const getUser = (id: string) => {
		const user = db.select().from(users).where(eq(users.id, id)).get();
		if (!user) throw notFound('User not found');
		return user;
	};

	/** Refuse changes that would leave the system without an admin. */
	const assertNotLastAdmin = (id: string) => {
		const others = db
			.select({ n: count() })
			.from(users)
			.where(and(eq(users.role, 'admin'), ne(users.id, id)))
			.get();
		if (!others?.n) throw badRequest('Cannot remove the last admin');
	};

	return {
		'/api/admin/users': {
			GET: (req) => {
				requireRole(app, req, 'admin');
				return json({ users: db.select().from(users).orderBy(asc(users.createdAt)).all().map(userDTO) });
			},
			POST: async (req) => {
				requireRole(app, req, 'admin');
				const body = await parseBody(req, CreateUserBody);
				const email = body.email.toLowerCase();
				if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) throw conflict('Email already in use');
				const user = db
					.insert(users)
					.values({ id: crypto.randomUUID(), role: body.role, email, passwordHash: await hashPassword(body.password), displayName: body.displayName })
					.returning()
					.get();
				return json({ user: userDTO(user) }, { status: 201 });
			}
		},
		'/api/admin/users/:id': {
			PATCH: async (req) => {
				requireRole(app, req, 'admin');
				const body = await parseBody(req, UpdateUserBody);
				const user = getUser(req.params.id!);
				if (user.role === 'admin' && body.role && body.role !== 'admin') assertNotLastAdmin(user.id);
				const patch: Partial<typeof users.$inferInsert> = {};
				if (body.role) patch.role = body.role;
				if (body.displayName) patch.displayName = body.displayName;
				if (body.password) patch.passwordHash = await hashPassword(body.password);
				const updated = Object.keys(patch).length ? db.update(users).set(patch).where(eq(users.id, user.id)).returning().get()! : user;
				// A password reset signs the user out everywhere.
				if (body.password) db.delete(sessions).where(eq(sessions.userId, user.id)).run();
				return json({ user: userDTO(updated) });
			},
			DELETE: (req) => {
				const me = requireRole(app, req, 'admin');
				const user = getUser(req.params.id!);
				if (user.id === me.id) throw badRequest('Cannot delete yourself');
				if (user.role === 'admin') assertNotLastAdmin(user.id);
				db.delete(users).where(eq(users.id, user.id)).run();
				return json({ ok: true });
			}
		}
	};
}
