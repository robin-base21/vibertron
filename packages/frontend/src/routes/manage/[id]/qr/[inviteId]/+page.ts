import { events } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const { event } = await events.get(params.id, fetch);
	return { event, inviteId: params.inviteId };
};
