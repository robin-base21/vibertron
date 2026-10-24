import { redirect } from '@sveltejs/kit';
import type { Fetch } from '$lib/api';
import { session } from '$lib/stores/session.svelte';
import { hasRole, type MeDTO, type Role } from 'common';

export function loginUrl(url: URL): string {
	return `/login?next=${encodeURIComponent(url.pathname + url.search)}`;
}

/** Use in load functions: redirects to /login when the session lacks `role`. */
export async function requireRole(role: Role, url: URL, fetch?: Fetch): Promise<MeDTO> {
	const me = await session.ensure(fetch);
	if (!hasRole(me.user?.role, role)) redirect(307, loginUrl(url));
	return me;
}
