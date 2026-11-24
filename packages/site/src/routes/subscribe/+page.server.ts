import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { subscribers } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

const Body = z.object({
	email: z.string().trim().toLowerCase().email().max(200),
	source: z.string().max(40).default('site')
});

export const load: PageServerLoad = () => ({});

export const actions: Actions = {
	default: async ({ request }) => {
		const parsed = Body.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'Enter a valid email address.' });
		const { email, source } = parsed.data;
		// Keep the original opt-in time if they subscribe again.
		db()
			.insert(subscribers)
			.values({ email, consentAt: new Date(), source })
			.onConflictDoNothing()
			.run();
		return { ok: true, email };
	}
};
