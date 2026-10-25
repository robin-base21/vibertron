import { dev } from '$app/environment';
import { fixtureParams } from '$lib/blueprint/liveFixture';
import type { PageLoad } from './$types';

// Public, no auth. `?fixture=open|live|ended[&teams=N][&voting=group|pitch|results][&draw]` previews with fixture data in dev.
export const load: PageLoad = ({ params, url }) => ({
	slug: params.slug,
	...fixtureParams(url, dev)
});
