import { error } from '@sveltejs/kit';
import { ApiError, events } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	try {
		const { event } = await events.get(params.id, fetch);
		return { event };
	} catch (err) {
		if (err instanceof ApiError && (err.status === 404 || err.status === 403))
			error(404, 'Event not found');
		throw err;
	}
};
