import { fail } from '@sveltejs/kit';
import { count, desc, eq } from 'drizzle-orm';
import { holdsSeat } from '$lib/seats';
import { db } from '$lib/server/db';
import { events, results, signups, subscribers } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const d = db();
	const now = new Date();
	// Counted in code with the same seat rules as the event page (held, finished or paid signups).
	const all = d.select().from(signups).all();
	const withResults = new Set(
		d
			.select({ id: results.eventId })
			.from(results)
			.all()
			.map((r) => r.id)
	);
	return {
		events: d
			.select()
			.from(events)
			.orderBy(desc(events.startsAt))
			.all()
			.map((e) => {
				const mine = all.filter((s) => s.eventId === e.id);
				return {
					...e,
					seated: mine.filter((s) => holdsSeat(s, now)).length,
					waitlist: mine.filter((s) => s.waitlist && !s.paid).length,
					paid: mine.filter((s) => s.paid).length,
					hasResults: withResults.has(e.id)
				};
			}),
		subscribers: d.select({ n: count() }).from(subscribers).get()?.n ?? 0
	};
};

export const actions: Actions = {
	/** The home page hero promotes this event (only one at a time); pressing again unfeatures it. */
	feature: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const d = db();
		const current = d.select().from(events).where(eq(events.id, id)).get();
		if (!current) return fail(404, { error: 'Event not found' });
		d.transaction((tx) => {
			tx.update(events).set({ featured: false }).run();
			if (!current.featured)
				tx.update(events).set({ featured: true }).where(eq(events.id, id)).run();
		});
		return {};
	}
};
