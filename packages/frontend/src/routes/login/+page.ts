import { redirect } from '@sveltejs/kit';
import { session } from '$lib/stores/session.svelte';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
	await session.ensure(fetch);
	const next = safeNext(url.searchParams.get('next'));
	if (session.is('manager')) redirect(307, next ?? '/manage');
	return { next };
};

/** Only allow same-site relative redirects. */
function safeNext(next: string | null): string | null {
	return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}
