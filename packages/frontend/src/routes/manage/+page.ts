import { events } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const { events: list } = await events.list(fetch);
	return { events: list };
};
