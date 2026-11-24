import type { Cookies } from '@sveltejs/kit';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { refundOnCancel } from '$lib/refund';
import { CONFIRM_WINDOW_MS, seatsLeft, signupState } from '$lib/seats';
import { DEFAULT_FORM, SignupForm, type Answers, type Deposit } from '$lib/signupForm';
import { db } from './db';
import { signups, subscribers } from './db/schema';
import { siteEnv } from './env';
import type { EventRow } from './events';

export type SignupRow = typeof signups.$inferSelect;

/** The event's form, falling back to the default template. */
export function formOf(event: EventRow): SignupForm {
	if (!event.form) return DEFAULT_FORM;
	const parsed = SignupForm.safeParse(JSON.parse(event.form));
	return parsed.success ? parsed.data : DEFAULT_FORM;
}

export function depositOf(event: EventRow): Deposit {
	return {
		amount: event.depositAmount,
		instructions: event.depositInstructions ?? '',
		note: event.depositNote ?? '',
		proofRequired: event.proofRequired,
		holdHours: event.holdHours,
		refundDays: event.refundDays
	};
}

/** Is there a deposit step for this signup? (Waitlisted people pay only once a seat opens.) */
export const needsDeposit = (event: EventRow, s: Pick<SignupRow, 'waitlist'>) =>
	event.depositAmount !== null && !s.waitlist;

export function eventSignups(eventId: string): SignupRow[] {
	return db().select().from(signups).where(eq(signups.eventId, eventId)).all();
}

export const parseAnswers = (s: SignupRow): Answers => {
	try {
		return JSON.parse(s.answers) as Answers;
	} catch {
		return {};
	}
};

// ----- resume: a per-event cookie with "<id>.<token>" -----

const cookieName = (eventId: string) => `signup_${eventId.slice(0, 8)}`;

export function rememberSignup(cookies: Cookies, s: SignupRow) {
	cookies.set(cookieName(s.eventId), `${s.id}.${s.token}`, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: siteEnv.secureCookies,
		maxAge: 60 * 60 * 24 * 90
	});
}

export const forgetSignup = (cookies: Cookies, eventId: string) =>
	cookies.delete(cookieName(eventId), { path: '/' });

/** The signup behind a "<id>.<token>" value, if it belongs to the event. */
export function signupByKey(eventId: string, key: string | undefined | null): SignupRow | null {
	const [id, token] = (key ?? '').split('.');
	if (!id || !token) return null;
	const row = db()
		.select()
		.from(signups)
		.where(and(eq(signups.id, id), eq(signups.eventId, eventId)))
		.get();
	return row && row.token === token ? row : null;
}

export const currentSignup = (cookies: Cookies, eventId: string) =>
	signupByKey(eventId, cookies.get(cookieName(eventId)));

export const resumeKey = (s: SignupRow) => `${s.id}.${s.token}`;

const newToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');

// ----- steps -----

/**
 * The seat someone gets: until the email is confirmed it is held for CONFIRM_WINDOW_MS. Once
 * confirmed, a free event saves it for good; with a deposit due it is held for holdHours, until the
 * payment screenshot arrives.
 */
function seatFor(
	event: EventRow,
	now: Date,
	o: { waitlist: boolean; confirmed: boolean }
): { seatedAt: Date | null; holdUntil: Date | null } {
	if (o.waitlist) return { seatedAt: null, holdUntil: null };
	if (!o.confirmed)
		return { seatedAt: null, holdUntil: new Date(now.getTime() + CONFIRM_WINDOW_MS) };
	return event.depositAmount === null
		? { seatedAt: now, holdUntil: null }
		: { seatedAt: null, holdUntil: new Date(now.getTime() + event.holdHours * 3_600_000) };
}

const othersHaveSeat = (
	tx: Pick<ReturnType<typeof db>, 'select'>,
	event: EventRow,
	id: string,
	now: Date
) =>
	seatsLeft(
		event.capacity,
		tx
			.select()
			.from(signups)
			.where(eq(signups.eventId, event.id))
			.all()
			.filter((r) => r.id !== id),
		now
	) !== 0;

/**
 * Step 1. Holds a seat (until the email is confirmed) if one is free, else the waitlist. Count and
 * insert happen in one synchronous transaction, so two people can't take the last seat at once.
 *
 * An email that already has a signup is only resumed on the device that started it (`mine`);
 * anyone else gets `existing` back and the owner is emailed a link instead, so typing someone's
 * address never opens their signup.
 */
export function startSignup(
	event: EventRow,
	contact: { name: string; email: string; phone: string },
	mine: SignupRow | null
): { signup: SignupRow; existing: boolean } {
	const found = db()
		.select()
		.from(signups)
		.where(and(eq(signups.eventId, event.id), eq(signups.email, contact.email)))
		.get();
	if (found && found.id !== mine?.id) return { signup: found, existing: true };
	if (found?.cancelledAt) return { signup: rejoin(event, found), existing: false };
	const row = db().transaction((tx) => {
		const now = new Date();
		if (found) {
			return tx
				.update(signups)
				.set({ name: contact.name, phone: contact.phone })
				.where(eq(signups.id, found.id))
				.returning()
				.get()!;
		}
		const left = seatsLeft(
			event.capacity,
			tx.select().from(signups).where(eq(signups.eventId, event.id)).all(),
			now
		);
		const waitlist = left === 0;
		return tx
			.insert(signups)
			.values({
				id: crypto.randomUUID(),
				eventId: event.id,
				name: contact.name,
				email: contact.email,
				phone: contact.phone,
				waitlist,
				...seatFor(event, now, { waitlist, confirmed: false }),
				step: 2,
				token: newToken()
			})
			.returning()
			.get();
	});
	// A returning signup whose hold ran out tries for a seat again.
	return { signup: refreshHold(event, row), existing: false };
}

/** An unfinished signup whose hold ran out gets a fresh hold if a seat is free, else the waitlist. */
export function refreshHold(event: EventRow, s: SignupRow): SignupRow {
	const now = new Date();
	if (signupState(s, now) !== 'expired') return s;
	return db().transaction((tx) => {
		const free = othersHaveSeat(tx, event, s.id, now);
		return tx
			.update(signups)
			.set(
				free
					? seatFor(event, now, { waitlist: false, confirmed: !!s.emailConfirmedAt })
					: { waitlist: true, holdUntil: null }
			)
			.where(eq(signups.id, s.id))
			.returning()
			.get()!;
	});
}

export function saveAbout(s: SignupRow, answers: Answers): SignupRow {
	const merged = { ...parseAnswers(s), ...answers };
	return db()
		.update(signups)
		.set({ answers: JSON.stringify(merged), step: Math.max(s.step, 3) })
		.where(eq(signups.id, s.id))
		.returning()
		.get()!;
}

/** Step 3. Without a deposit step this finishes the signup. */
export function saveConfirmations(
	event: EventRow,
	s: SignupRow,
	confirmed: string[],
	newsletter: boolean | null
): SignupRow {
	const answers = { ...parseAnswers(s), ...Object.fromEntries(confirmed.map((id) => [id, 'yes'])) };
	const finish = !needsDeposit(event, s);
	const now = new Date();
	const row = db()
		.update(signups)
		.set({
			answers: JSON.stringify(answers),
			newsletter,
			marketingConsent: newsletter === true,
			step: Math.max(s.step, 4),
			...(finish && !s.completedAt ? { completedAt: now } : {})
		})
		.where(eq(signups.id, s.id))
		.returning()
		.get()!;
	if (newsletter)
		db()
			.insert(subscribers)
			.values({ email: s.email, consentAt: now, source: `signup:${event.slug}` })
			.onConflictDoNothing()
			.run();
	return row;
}

// ----- deposit proof (payment screenshot) -----

export const PROOF_MAX_BYTES = 10 * 1024 * 1024;

/** Image type from the first bytes; phones send PNG/JPEG screenshots, iPhones sometimes HEIC. */
export function sniffImage(b: Uint8Array): { type: string; ext: string } | null {
	const at = (o: number, ...xs: number[]) => xs.every((x, i) => b[o + i] === x);
	if (at(0, 0x89, 0x50, 0x4e, 0x47)) return { type: 'image/png', ext: 'png' };
	if (at(0, 0xff, 0xd8, 0xff)) return { type: 'image/jpeg', ext: 'jpg' };
	if (at(0, 0x47, 0x49, 0x46, 0x38)) return { type: 'image/gif', ext: 'gif' };
	if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50))
		return { type: 'image/webp', ext: 'webp' };
	if (
		at(4, 0x66, 0x74, 0x79, 0x70) &&
		/^(heic|heix|mif1|msf1)$/.test(new TextDecoder().decode(b.subarray(8, 12)))
	) {
		return { type: 'image/heic', ext: 'heic' };
	}
	return null;
}

const proofDir = (eventId: string) => resolve(siteEnv.dataDir, 'proofs', eventId);
export const proofPath = (s: Pick<SignupRow, 'eventId' | 'proofRef'>) =>
	s.proofRef ? join(proofDir(s.eventId), s.proofRef) : null;

/** Step 4 with a screenshot: stores it and finishes the signup (the seat is theirs from now on). */
export async function saveProof(s: SignupRow, bytes: Uint8Array): Promise<SignupRow> {
	const kind = sniffImage(bytes);
	if (!kind) throw new Error('Upload a screenshot (PNG, JPEG, WebP or HEIC)');
	await mkdir(proofDir(s.eventId), { recursive: true });
	const ref = `${s.id}-${Date.now()}.${kind.ext}`;
	await Bun.write(join(proofDir(s.eventId), ref), bytes);
	const old = proofPath(s);
	if (old) await rm(old, { force: true });
	const now = new Date();
	return db()
		.update(signups)
		.set({ proofRef: ref, proofAt: now, completedAt: s.completedAt ?? now })
		.where(eq(signups.id, s.id))
		.returning()
		.get()!;
}

/** Step 4 when the event doesn't require a screenshot ("I've sent it" / "I'll pay at the door"). */
export function finishWithoutProof(s: SignupRow): SignupRow {
	return db()
		.update(signups)
		.set({ completedAt: s.completedAt ?? new Date() })
		.where(eq(signups.id, s.id))
		.returning()
		.get()!;
}

/**
 * The person can't come: the seat is free again right away. A paid deposit is due back if they
 * cancelled before the event's refund deadline.
 */
export function cancelSignup(event: EventRow, s: SignupRow): SignupRow {
	if (s.cancelledAt) return s;
	const now = new Date();
	const paid = s.paid || !!s.proofAt;
	return db()
		.update(signups)
		.set({
			cancelledAt: now,
			refundDue: paid ? refundOnCancel(now, event.startsAt, event.refundDays) : null
		})
		.where(eq(signups.id, s.id))
		.returning()
		.get()!;
}

/** Signing up again after cancelling: a seat if one is free (answers kept), else the waitlist. */
export function rejoin(event: EventRow, s: SignupRow): SignupRow {
	if (!s.cancelledAt) return s;
	// The deposit went back to them: this signup pays (and proves it) again.
	const repay = !!s.refundedAt && event.depositAmount !== null;
	const paidBefore = !repay && (s.paid || !!s.proofAt);
	const row = db().transaction((tx) => {
		const now = new Date();
		const free = othersHaveSeat(tx, event, s.id, now);
		const seat = !free
			? { waitlist: true, holdUntil: null, seatedAt: null }
			: {
					waitlist: false,
					...(s.completedAt && (event.depositAmount === null || paidBefore)
						? {}
						: seatFor(event, now, { waitlist: false, confirmed: !!s.emailConfirmedAt }))
				};
		return tx
			.update(signups)
			.set({
				cancelledAt: null,
				refundDue: null,
				refundedAt: null,
				...(repay
					? {
							paid: false,
							paidAt: null,
							proofRef: null,
							proofAt: null,
							completedAt: null,
							step: Math.min(s.step, 4)
						}
					: {}),
				...seat
			})
			.where(eq(signups.id, s.id))
			.returning()
			.get()!;
	});
	// The old payment screenshot belongs to the refunded payment.
	const oldProof = repay ? proofPath(s) : null;
	if (oldProof) void rm(oldProof, { force: true });
	return row;
}

/**
 * The confirmation link was clicked. A live hold (or a free seat, if it ran out) becomes theirs: a
 * free event saves it, a paid one holds it for holdHours until the deposit. No seat left: waitlist.
 */
export function confirmEmail(event: EventRow, s: SignupRow): SignupRow {
	if (s.emailConfirmedAt) return s;
	return db().transaction((tx) => {
		const now = new Date();
		const state = signupState(s, now);
		const keep =
			s.paid || s.waitlist || state === 'unconfirmed' || othersHaveSeat(tx, event, s.id, now);
		const seat =
			s.paid || s.waitlist
				? {}
				: keep
					? s.completedAt && (event.depositAmount === null || s.proofAt)
						? {}
						: seatFor(event, now, { waitlist: false, confirmed: true })
					: { waitlist: true, holdUntil: null };
		return tx
			.update(signups)
			.set({ emailConfirmedAt: now, ...seat })
			.where(eq(signups.id, s.id))
			.returning()
			.get()!;
	});
}

/**
 * Admin moved someone off the waitlist. With a deposit due, they get a fresh hold and must finish
 * step 4 (they are emailed their link); otherwise their seat is saved for good. An unconfirmed
 * address gets a hold as well: the emailed link confirms it.
 */
export function promote(event: EventRow, s: SignupRow): SignupRow {
	const now = new Date();
	const due = event.depositAmount !== null && !s.paid && !s.proofAt;
	const hold = new Date(now.getTime() + event.holdHours * 3_600_000);
	return db()
		.update(signups)
		.set({
			waitlist: false,
			...(due
				? { completedAt: null, holdUntil: hold, step: Math.max(s.step, 4) }
				: { seatedAt: s.seatedAt ?? now, holdUntil: s.emailConfirmedAt ? null : hold })
		})
		.where(eq(signups.id, s.id))
		.returning()
		.get()!;
}
