import { session } from '$lib/stores/session.svelte';
import type { LayoutLoad } from './$types';

// The API lives on another origin with its own session cookie, so render on the client only.
export const ssr = false;

export const load: LayoutLoad = async ({ fetch }) => {
	await session.ensure(fetch);
	return {};
};
