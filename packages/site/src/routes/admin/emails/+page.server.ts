import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { emails, events } from '$lib/server/db/schema';
import { mailConfigured } from '$lib/server/mail';
import { siteEnv } from '$lib/server/env';
import type { PageServerLoad } from './$types';

/** The latest emails the site sent or (without an API key) only logged. */
export const load: PageServerLoad = () => ({
	configured: mailConfigured(),
	from: siteEnv.mailFrom,
	emails: db()
		.select({
			id: emails.id,
			kind: emails.kind,
			to: emails.to,
			subject: emails.subject,
			html: emails.html,
			status: emails.status,
			error: emails.error,
			createdAt: emails.createdAt,
			eventName: events.name
		})
		.from(emails)
		.leftJoin(events, eq(events.id, emails.eventId))
		.orderBy(desc(emails.createdAt))
		.limit(200)
		.all()
});
