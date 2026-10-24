import { and, eq, gt, lt } from 'drizzle-orm';
import type { DB } from '../db';
import { sessions, users } from '../db/schema';
import { parseCookies } from '../http';

export const SESSION_COOKIE = 'vt_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type User = typeof users.$inferSelect;

export function hashToken(token: string): string {
	return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

export function randomToken(bytes = 32): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

/** Creates a session row and returns the Set-Cookie header value. */
export function createSession(db: DB, userId: string, secure: boolean): string {
	const token = randomToken();
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
	db.insert(sessions).values({ id: hashToken(token), userId, expiresAt }).run();
	return sessionCookie(token, expiresAt, secure);
}

export function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
	const parts = [
		`${SESSION_COOKIE}=${token}`,
		'Path=/',
		'HttpOnly',
		'SameSite=Lax',
		`Expires=${expiresAt.toUTCString()}`,
		`Max-Age=${Math.floor((expiresAt.getTime() - Date.now()) / 1000)}`
	];
	if (secure) parts.push('Secure');
	return parts.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
	return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function sessionToken(req: Request): string | null {
	return parseCookies(req.headers.get('cookie'))[SESSION_COOKIE] ?? null;
}

export function getSessionUser(db: DB, req: Request): User | null {
	const token = sessionToken(req);
	if (!token) return null;
	const row = db
		.select({ user: users })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
		.get();
	return row?.user ?? null;
}

export function destroySession(db: DB, req: Request) {
	const token = sessionToken(req);
	if (token) db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
}

export function purgeExpiredSessions(db: DB) {
	db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
}

export const hashPassword = (password: string) => Bun.password.hash(password);
export const verifyPassword = (password: string, hash: string) => Bun.password.verify(password, hash);
