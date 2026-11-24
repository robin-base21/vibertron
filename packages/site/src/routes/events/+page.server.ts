import { pastEvents, spotsLeft, upcomingEvents, winnerOf } from '$lib/server/events';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	upcoming: upcomingEvents().map((event) => ({ event, spotsLeft: spotsLeft(event) })),
	past: pastEvents().map(({ event, results }) => ({
		event,
		winner: winnerOf(results),
		stats: results
			? {
					participants: results.event.participantCount,
					teams: results.event.teamCount,
					projects: results.projects.length
				}
			: null
	}))
});
