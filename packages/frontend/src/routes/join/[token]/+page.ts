import { error, redirect } from '@sveltejs/kit';
import { ApiError, join } from '$lib/api';
import { session } from '$lib/stores/session.svelte';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params, url }) => {
	const [me, res] = await Promise.all([
		session.ensure(fetch),
		join.get(params.token, fetch).catch((err: unknown) => {
			if (err instanceof ApiError && (err.status === 404 || err.status === 410))
				error(404, 'This invite is no longer valid');
			throw err;
		})
	]);
	// Already in? Skip the form.
	if (me.participations.some((p) => p.eventId === res.event.id)) redirect(307, `/e/${res.event.slug}`);
	return { token: params.token, code: url.searchParams.get('c')?.trim().toUpperCase() ?? '', event: res.event };
};
