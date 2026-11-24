import { isAdmin } from '$lib/server/admin';
import { heroEvent } from '$lib/server/events';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies }) => {
	const next = heroEvent();
	return {
		nextEvent: next ? { slug: next.slug, name: next.name } : null,
		/** Signed in as admin: show the admin bar on every page. */
		admin: isAdmin(cookies)
	};
};
