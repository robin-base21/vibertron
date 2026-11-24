import { fail, redirect } from '@sveltejs/kit';
import { checkPassword, startSession } from '$lib/server/admin';
import { siteEnv } from '$lib/server/env';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ enabled: !!siteEnv.adminPassword });

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const password = String((await request.formData()).get('password') ?? '');
		if (!checkPassword(password)) return fail(401, { error: 'Wrong password' });
		startSession(cookies);
		const next = url.searchParams.get('next');
		redirect(303, next?.startsWith('/admin') ? next : '/admin');
	}
};
