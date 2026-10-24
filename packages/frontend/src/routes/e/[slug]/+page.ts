import { redirect } from '@sveltejs/kit';
import { ApiError, attendee, live } from '$lib/api';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	try {
		const [ctx, snapshot] = await Promise.all([
			attendee.me(params.slug, fetch),
			live.snapshot(params.slug, fetch).catch(() => null)
		]);
		return { ctx, snapshot };
	} catch (err) {
		// Not a participant (or no session): show the public view instead.
		if (err instanceof ApiError && [401, 403, 404].includes(err.status))
			redirect(307, `/e/${params.slug}/live`);
		throw err;
	}
};
