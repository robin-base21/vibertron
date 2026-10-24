import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { seedAdmin } from '../src/db/seed';
import { ADMIN, bootTestServer } from './helpers';

let srv: Awaited<ReturnType<typeof bootTestServer>>;
beforeAll(async () => {
	srv = await bootTestServer();
});
afterAll(() => srv.close());

describe('auth + admin', () => {
	test('seed is idempotent', async () => {
		expect(await seedAdmin(srv.app.db, ADMIN.email, ADMIN.password)).toBe(false);
	});

	test('health, CORS and preflight', async () => {
		const res = await fetch(`${srv.url}/api/health`);
		expect(res.status).toBe(200);
		expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
		expect(res.headers.get('access-control-allow-credentials')).toBe('true');
		const pre = await fetch(`${srv.url}/api/auth/login`, { method: 'OPTIONS' });
		expect(pre.status).toBe(204);
		expect(pre.headers.get('access-control-allow-methods')).toContain('PATCH');
		const missing = await fetch(`${srv.url}/api/nope`);
		expect(missing.status).toBe(404);
		expect(((await missing.json()) as any).error).toBe('not_found');
	});

	test('login, me, logout', async () => {
		const c = srv.client();
		expect((await c.get('/api/auth/me')).body).toEqual({ user: null, participations: [] });
		expect((await c.post('/api/auth/login', { email: ADMIN.email, password: 'wrong' })).status).toBe(401);
		expect((await c.post('/api/auth/login', { email: 'not-an-email', password: 'x' })).status).toBe(400);
		const user = await c.login(ADMIN.email, ADMIN.password);
		expect(user.role).toBe('admin');
		expect((await c.get('/api/auth/me')).body.user.email).toBe(ADMIN.email);
		expect((await c.post('/api/auth/logout')).status).toBe(200);
		expect((await c.get('/api/auth/me')).body.user).toBeNull();
	});

	test('admin manages users; managers cannot', async () => {
		const admin = srv.client();
		await admin.login(ADMIN.email, ADMIN.password);
		const created = await admin.post('/api/admin/users', { email: 'm@test.dev', password: 'manager-pw', displayName: 'Manny', role: 'manager' });
		expect(created.status).toBe(201);
		expect((await admin.post('/api/admin/users', { email: 'm@test.dev', password: 'manager-pw', displayName: 'X', role: 'manager' })).status).toBe(409);
		const id = created.body.user.id;

		const mgr = srv.client();
		await mgr.login('m@test.dev', 'manager-pw');
		expect((await mgr.get('/api/admin/users')).status).toBe(403);
		expect((await srv.client().get('/api/admin/users')).status).toBe(401);

		const patched = await admin.patch(`/api/admin/users/${id}`, { displayName: 'Manuela', password: 'new-password' });
		expect(patched.body.user.displayName).toBe('Manuela');
		// password reset revokes sessions
		expect((await mgr.get('/api/auth/me')).body.user).toBeNull();
		await mgr.login('m@test.dev', 'new-password');

		const list = await admin.get('/api/admin/users');
		expect(list.body.users).toHaveLength(2);
		expect((await admin.del(`/api/admin/users/${admin.cookie && list.body.users.find((u: any) => u.role === 'admin').id}`)).status).toBe(400);
		expect((await admin.del(`/api/admin/users/${id}`)).status).toBe(200);
		expect((await admin.del(`/api/admin/users/${id}`)).status).toBe(404);
	});
});
