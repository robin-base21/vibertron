import { fail } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { events, subscribers } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

/** The "stay in the loop" list: who, since when, and where they opted in. */
export const load: PageServerLoad = () => {
	const names = new Map(
		db()
			.select({ slug: events.slug, name: events.name })
			.from(events)
			.all()
			.map((e) => [e.slug, e.name])
	);
	return {
		subscribers: db()
			.select()
			.from(subscribers)
			.orderBy(desc(subscribers.consentAt))
			.all()
			.map((s) => {
				const slug = s.source.startsWith('signup:') ? s.source.slice(7) : null;
				return {
					email: s.email,
					consentAt: s.consentAt,
					from: slug ? `Signup: ${names.get(slug) ?? slug}` : 'Newsletter form',
					eventSlug: slug && names.has(slug) ? slug : null
				};
			})
	};
};

export const actions: Actions = {
	remove: async ({ request }) => {
		const email = String((await request.formData()).get('email') ?? '');
		if (!email) return fail(400, { error: 'No email given' });
		db().delete(subscribers).where(eq(subscribers.email, email)).run();
		return {};
	}
};
