import { CONFIRM_WINDOW_MS } from '$lib/seats';
import { alreadySent, sendMail } from './mail';
import {
	cancelledMail,
	confirmMail,
	organiserCancelledMail,
	doneMail,
	paidMail,
	promotedMail,
	resumeMail,
	type Refund,
	type Rendered
} from './mailTemplates';
import type { EventRow } from './events';
import { eventSignups, resumeKey, type SignupRow } from './signups';
import { siteEnv } from './env';

// The emails around one signup. `origin` is the site's public origin (the request's).

/** Opens (and, from an inbox, confirms) the signup on any device. */
export const signupLink = (origin: string, e: EventRow, s: SignupRow) =>
	`${origin}/events/${e.slug}/signup?r=${resumeKey(s)}`;

/** A resend of the confirmation/resume mail is allowed once a minute. */
export const RESEND_AFTER_MS = 60_000;

const send = (
	kind: Parameters<typeof sendMail>[0]['kind'],
	e: EventRow,
	s: SignupRow,
	r: Rendered
) => sendMail({ kind, to: s.email, eventId: e.id, signupId: s.id, ...r });

const recently = (s: SignupRow, kind: 'confirm' | 'resume') =>
	alreadySent(s.id, kind, new Date(Date.now() - RESEND_AFTER_MS));

/** Step 1 (or "resend"). Returns false when throttled or the send failed. */
export async function sendConfirm(origin: string, e: EventRow, s: SignupRow): Promise<boolean> {
	if (s.emailConfirmedAt || recently(s, 'confirm')) return false;
	return send(
		'confirm',
		e,
		s,
		confirmMail(origin, e, {
			name: s.name,
			link: signupLink(origin, e, s),
			holdUntil: s.waitlist ? null : (s.holdUntil ?? new Date(Date.now() + CONFIRM_WINDOW_MS)),
			waitlist: s.waitlist
		})
	);
}

/** Someone else typed this address at step 1: mail the owner their link. */
export async function sendResume(origin: string, e: EventRow, s: SignupRow): Promise<void> {
	if (recently(s, 'resume')) return;
	await send(
		'resume',
		e,
		s,
		resumeMail(origin, e, { name: s.name, link: signupLink(origin, e, s) })
	);
}

/** Once every step is done and the email confirmed: "You're in" (or "on the waitlist"), once. */
export async function sendDoneIfReady(origin: string, e: EventRow, s: SignupRow): Promise<void> {
	const finished = !!(s.completedAt || (s.waitlist && s.step >= 4));
	if (!finished || !s.emailConfirmedAt || alreadySent(s.id, 'done')) return;
	await send(
		'done',
		e,
		s,
		doneMail(origin, e, {
			name: s.name,
			link: signupLink(origin, e, s),
			waitlist: s.waitlist,
			depositPending: e.depositAmount !== null && !s.paid && !s.waitlist
		})
	);
}

export async function sendPromoted(origin: string, e: EventRow, s: SignupRow): Promise<void> {
	await send(
		'promoted',
		e,
		s,
		promotedMail(origin, e, {
			name: s.name,
			link: signupLink(origin, e, s),
			depositDue: e.depositAmount !== null && !s.paid && !s.proofAt,
			holdUntil: s.holdUntil
		})
	);
}

/** Only the first time it is marked paid (toggling back and forth sends nothing more). */
export async function sendPaid(origin: string, e: EventRow, s: SignupRow): Promise<void> {
	if (alreadySent(s.id, 'paid')) return;
	await send('paid', e, s, paidMail(origin, e, { name: s.name, link: signupLink(origin, e, s) }));
}

/** Cancellation: a confirmation to the person, and a heads-up to the organisers (with the waitlist). */
export async function sendCancelled(origin: string, e: EventRow, s: SignupRow): Promise<void> {
	const refund: Refund = !(s.paid || s.proofAt)
		? null
		: s.refundDue === true
			? 'due'
			: s.refundDue === false
				? 'late'
				: 'ask';
	if (s.emailConfirmedAt)
		await send(
			'cancelled',
			e,
			s,
			cancelledMail(origin, e, {
				name: s.name,
				link: signupLink(origin, e, s),
				refund,
				contact: siteEnv.adminEmail || null
			})
		);
	const to = siteEnv.adminEmail;
	if (!to) return;
	const waitlist = eventSignups(e.id)
		.filter((r) => r.waitlist && !r.cancelledAt)
		.map((r) => r.name);
	await sendMail({
		kind: 'organiser',
		to,
		eventId: e.id,
		signupId: s.id,
		...organiserCancelledMail(origin, e, {
			name: s.name,
			email: s.email,
			refund,
			waitlist,
			adminUrl: `${origin}/admin/events/${e.id}?tab=signups`
		})
	});
}
