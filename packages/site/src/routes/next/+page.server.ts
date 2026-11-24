import { redirect } from '@sveltejs/kit';
import { heroEvent } from '$lib/server/events';
import type { PageServerLoad } from './$types';

/** "Next event" landing: straight to it once there is one, else the get-notified page. */
export const load: PageServerLoad = () => {
	const next = heroEvent();
	if (next) redirect(303, `/events/${next.slug}/signup`);
	return {};
};
