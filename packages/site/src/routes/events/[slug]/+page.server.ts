import { error } from '@sveltejs/kit';
import { signupState } from '$lib/seats';
import { eventBySlug, showcaseItems, spotsLeft } from '$lib/server/events';
import { currentSignup } from '$lib/server/signups';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, cookies, url }) => {
	const found = eventBySlug(params.slug);
	if (!found || !found.event.published) error(404, 'Event not found');
	const { event, results } = found;
	// This device's signup, so the page can say "continue" or "you're in".
	const mine = currentSignup(cookies, event.id);
	return {
		event,
		spotsLeft: spotsLeft(event),
		flyer: event.flyerId
			? { src: `/flyers/${event.flyerId}`, abs: `${url.origin}/flyers/${event.flyerId}` }
			: null,
		results,
		projects: showcaseItems([{ event, results }]),
		mine: mine && {
			name: mine.name,
			state: signupState(mine, new Date()),
			emailConfirmed: !!mine.emailConfirmedAt,
			finished: !!(mine.completedAt || mine.paid || (mine.waitlist && mine.step >= 4))
		}
	};
};
