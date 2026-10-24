import { dev } from '$app/environment';
import type { PageLoad } from './$types';

// Public, no auth. `?fixture=open|live|ended[&teams=N]` previews with fixture data in dev.
export const load: PageLoad = ({ params, url }) => {
	const f = url.searchParams.get('fixture');
	const fixture = dev && f !== null ? ((['open', 'live', 'ended'].includes(f) ? f : 'live') as 'open' | 'live' | 'ended') : null;
	const fixtureTeams = Number(url.searchParams.get('teams')) || 0;
	return { slug: params.slug, fixture, fixtureTeams };
};
