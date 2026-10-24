import { redirect } from '@sveltejs/kit';
import { session } from '$lib/stores/session.svelte';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	await session.ensure(fetch);
	if (session.is('manager')) redirect(307, '/manage');
	return {};
};
