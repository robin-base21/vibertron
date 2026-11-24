import { error } from '@sveltejs/kit';
import { checkUnsubscribe, unsubscribe } from '$lib/server/announce';
import type { Actions, PageServerLoad } from './$types';

// The link in announcement emails. Opening it only asks; the button unsubscribes (link scanners
// in mail clients open links, and must not unsubscribe anyone).

function verified(url: URL) {
	const email = url.searchParams.get('e') ?? '';
	const sig = url.searchParams.get('s') ?? '';
	if (!email || !checkUnsubscribe(email, sig)) error(400, 'This unsubscribe link is not valid');
	return email;
}

export const load: PageServerLoad = ({ url }) => ({ email: verified(url) });

export const actions: Actions = {
	default: ({ url }) => {
		unsubscribe(verified(url));
		return { done: true };
	}
};
