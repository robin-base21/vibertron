import { admin, events } from '$lib/api';
import { requireRole } from '$lib/guards';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
	await requireRole('admin', url, fetch);
	const [{ users }, { events: list }] = await Promise.all([
		admin.listUsers(fetch),
		events.list(fetch)
	]);
	return { users, events: list };
};
