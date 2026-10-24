import { error, redirect } from '@sveltejs/kit';
import type { Fetch } from '$lib/api';
import { session } from '$lib/stores/session.svelte';
import { hasRole, type MeDTO, type Role } from 'common';

export function loginUrl(url: URL): string {
	return `/login?next=${encodeURIComponent(url.pathname + url.search)}`;
}

/**
 * Use in load functions: redirects to /login when signed out (or signed in as an attendee,
 * who can't log in as staff anyway); signed-in staff without the role get a 403.
 */
export async function requireRole(role: Role, url: URL, fetch?: Fetch): Promise<MeDTO> {
	const me = await session.ensure(fetch);
	if (hasRole(me.user?.role, role)) return me;
	if (hasRole(me.user?.role, 'manager')) error(403, 'You don’t have access to this page');
	redirect(307, loginUrl(url));
}
