import { fail, redirect } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { events } from '$lib/server/db/schema';
import { parseEventForm } from '$lib/server/eventForm';
import { formOf } from '$lib/server/signups';
import { aiConfigured } from '$lib/server/ai';
import type { Actions, PageServerLoad } from './$types';

/** Earlier events to copy the signup form and deposit settings from, newest first. */
export const load: PageServerLoad = () => ({
	ai: aiConfigured(),
	templates: db()
		.select()
		.from(events)
		.orderBy(desc(events.createdAt))
		.all()
		.filter((e) => e.form)
		.map((e) => ({
			id: e.id,
			name: e.name,
			form: formOf(e),
			deposit: {
				depositAmount: e.depositAmount,
				depositInstructions: e.depositInstructions,
				depositNote: e.depositNote,
				proofRequired: e.proofRequired,
				holdHours: e.holdHours,
				refundDays: e.refundDays
			}
		}))
});

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await parseEventForm(request);
		if (!form.ok) return fail(400, { error: form.error });
		const id = crypto.randomUUID();
		db()
			.insert(events)
			.values({ id, ...form.values })
			.run();
		redirect(303, `/admin/events/${id}`);
	}
};
