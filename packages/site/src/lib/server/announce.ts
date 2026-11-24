import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { events, signups, subscribers } from './db/schema';
import { siteEnv } from './env';
import type { EventRow } from './events';
import { sendMany } from './mail';
import { announceMail } from './mailTemplates';

// "Stay in the loop" mails: the admin announces an event to the subscriber list. Every mail has an
// unsubscribe link signed with a site secret, so it works without logging in.

const secret = () => `unsubscribe:${siteEnv.publishSecret || siteEnv.adminPassword}`;

export const unsubscribeSig = (email: string) =>
	createHmac('sha256', secret()).update(email.toLowerCase()).digest('hex').slice(0, 32);

export function checkUnsubscribe(email: string, sig: string): boolean {
	const a = Buffer.from(unsubscribeSig(email));
	const b = Buffer.from(sig);
	return a.length === b.length && timingSafeEqual(a, b);
}

export const unsubscribeUrl = (origin: string, email: string) =>
	`${origin}/unsubscribe?e=${encodeURIComponent(email)}&s=${unsubscribeSig(email)}`;

/** Subscribers to announce this event to: everyone not already signed up for it. */
export function audienceOf(event: EventRow): string[] {
	const signedUp = new Set(
		db()
			.select({ email: signups.email })
			.from(signups)
			.where(eq(signups.eventId, event.id))
			.all()
			.map((r) => r.email.toLowerCase())
	);
	return db()
		.select({ email: subscribers.email })
		.from(subscribers)
		.all()
		.map((r) => r.email)
		.filter((e) => !signedUp.has(e.toLowerCase()));
}

export async function announce(origin: string, event: EventRow) {
	const mails = audienceOf(event).map((to) => {
		const unsubscribe = unsubscribeUrl(origin, to);
		return {
			kind: 'announce' as const,
			to,
			eventId: event.id,
			headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
			...announceMail(origin, event, unsubscribe)
		};
	});
	const result = await sendMany(mails);
	if (result.sent)
		db().update(events).set({ announcedAt: new Date() }).where(eq(events.id, event.id)).run();
	return result;
}

export function unsubscribe(email: string) {
	db().delete(subscribers).where(eq(subscribers.email, email)).run();
}
