import { redirect, type Handle } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/admin';

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	if (path.startsWith('/admin') && path !== '/admin/login' && !isAdmin(event.cookies)) {
		redirect(303, `/admin/login?next=${encodeURIComponent(path)}`);
	}
	return resolve(event);
};
