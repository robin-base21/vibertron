import { error } from '@sveltejs/kit';
import { ApiError, events, invites } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	try {
		const [{ event }, { participants }, { invites: inviteList }] = await Promise.all([
			events.get(params.id, fetch),
			events.participants(params.id, fetch),
			invites.list(params.id, fetch)
		]);
		return { event, participants, invites: inviteList };
	} catch (err) {
		if (err instanceof ApiError && (err.status === 404 || err.status === 403))
			error(404, 'Event not found');
		throw err;
	}
};
