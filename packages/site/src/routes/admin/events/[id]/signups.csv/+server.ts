import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { STATE_LABEL, signupState } from '$lib/seats';
import { answerText } from '$lib/signupForm';
import { csvResponse, toCsv } from '$lib/server/csv';
import { db } from '$lib/server/db';
import { events, signups } from '$lib/server/db/schema';
import { formOf, parseAnswers } from '$lib/server/signups';
import type { RequestHandler } from './$types';

/** One row per signup, one column per question and confirmation. */
export const GET: RequestHandler = ({ params }) => {
	const event = db().select().from(events).where(eq(events.id, params.id)).get();
	if (!event) error(404, 'Event not found');
	const form = formOf(event);
	const rows = db()
		.select()
		.from(signups)
		.where(eq(signups.eventId, event.id))
		.orderBy(asc(signups.createdAt))
		.all();
	const iso = (d: Date | null) => (d ? d.toISOString() : null);
	const now = new Date();
	return csvResponse(
		toCsv([
			[
				'name',
				'email',
				'phone',
				'status',
				'signed_up_at',
				'paid',
				'paid_at',
				'deposit_screenshot_at',
				...form.about.map((q) => q.label),
				...form.confirmations.map((c) => c.title),
				'email_next_signup'
			],
			...rows.map((s) => {
				const answers = parseAnswers(s);
				return [
					s.name,
					s.email,
					s.phone,
					STATE_LABEL[signupState(s, now)],
					iso(s.createdAt),
					s.paid,
					iso(s.paidAt),
					iso(s.proofAt),
					...form.about.map((q) => answerText(answers[q.id])),
					...form.confirmations.map((c) => (answers[c.id] === 'yes' ? 'yes' : '')),
					s.newsletter === null ? '' : s.newsletter
				];
			})
		]),
		`${event.slug}-signups.csv`
	);
};
