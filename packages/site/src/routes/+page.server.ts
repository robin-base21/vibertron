import {
	heroEvent,
	pastEvents,
	showcaseItems,
	spotsLeft,
	upcomingEvents,
	winnerOf
} from '$lib/server/events';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const past = pastEvents(6);
	return {
		upcoming: upcomingEvents().map((event) => ({ event, spotsLeft: spotsLeft(event) })),
		hero: heroEvent(),
		past: past.map(({ event, results }) => ({
			event,
			winner: winnerOf(results),
			stats: results
				? {
						participants: results.event.participantCount,
						teams: results.event.teamCount,
						projects: results.projects.length
					}
				: null
		})),
		showcase: showcaseItems(past).slice(0, 6)
	};
};
