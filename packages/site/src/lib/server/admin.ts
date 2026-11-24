import type { Cookies } from '@sveltejs/kit';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { siteEnv } from './env';

// One shared admin password (SITE_ADMIN_PASSWORD). The session cookie is "<expiry>.<hmac>", so
// changing the password signs everyone out.

const COOKIE = 'site_admin';
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

const sign = (expires: string) =>
	createHmac('sha256', `site-admin:${siteEnv.adminPassword}`).update(expires).digest('hex');

function same(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(password: string): boolean {
	return !!siteEnv.adminPassword && same(password, siteEnv.adminPassword);
}

export function startSession(cookies: Cookies) {
	const expires = String(Date.now() + TTL_MS);
	cookies.set(COOKIE, `${expires}.${sign(expires)}`, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: siteEnv.secureCookies,
		maxAge: TTL_MS / 1000
	});
}

export function endSession(cookies: Cookies) {
	cookies.delete(COOKIE, { path: '/' });
}

export function isAdmin(cookies: Cookies): boolean {
	if (!siteEnv.adminPassword) return false;
	const [expires, mac] = (cookies.get(COOKIE) ?? '').split('.');
	return !!expires && !!mac && Number(expires) > Date.now() && same(mac, sign(expires));
}
