import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { refundDeadline } from '$lib/refund';
import { siteEnv } from '$lib/server/env';
import { signupState } from '$lib/seats';
import { validateAbout } from '$lib/signupForm';
import { eventBySlug, spotsLeft } from '$lib/server/events';
import {
	PROOF_MAX_BYTES,
	cancelSignup,
	confirmEmail,
	currentSignup,
	depositOf,
	finishWithoutProof,
	forgetSignup,
	formOf,
	needsDeposit,
	parseAnswers,
	refreshHold,
	rejoin,
	rememberSignup,
	saveAbout,
	saveConfirmations,
	saveProof,
	signupByKey,
	startSignup,
	type SignupRow
} from '$lib/server/signups';
import { sendCancelled, sendConfirm, sendDoneIfReady, sendResume } from '$lib/server/signupMail';
import type { Actions, PageServerLoad } from './$types';

/** Steps this signup goes through, in order. */
export type Step = 'contact' | 'about' | 'before' | 'deposit' | 'done';
const STEP_NUMBER: Record<Exclude<Step, 'done'>, number> = {
	contact: 1,
	about: 2,
	before: 3,
	deposit: 4
};

function openEvent(slug: string) {
	const found = eventBySlug(slug);
	if (!found || !found.event.published) error(404, 'Event not found');
	return found;
}

function stepsFor(event: ReturnType<typeof openEvent>['event'], signup: SignupRow | null): Step[] {
	const form = formOf(event);
	const steps: Step[] = ['contact'];
	if (form.about.length) steps.push('about');
	if (form.confirmations.length || form.askNewsletter) steps.push('before');
	if (!signup ? event.depositAmount !== null : needsDeposit(event, signup)) steps.push('deposit');
	return steps;
}

/** The step to show: the requested one if already reached, else the furthest reached. */
function stepToShow(steps: Step[], signup: SignupRow | null, requested: string | null): Step {
	if (!signup) return 'contact';
	const reached = steps.filter(
		(s) => s === 'contact' || STEP_NUMBER[s as Exclude<Step, 'done'>] <= signup.step
	);
	if (requested && (reached as string[]).includes(requested)) return requested as Step;
	if (signup.completedAt || signup.paid || (signup.waitlist && signup.step >= 4)) return 'done';
	return reached.at(-1) ?? 'contact';
}

export const load: PageServerLoad = async ({ params, cookies, url }) => {
	const { event, results } = openEvent(params.slug);

	// The link from the confirmation email (or one an organiser sent): it proves the inbox, so it
	// confirms the email. Remember the signup on this device, then drop the key from the URL.
	const key = url.searchParams.get('r');
	if (key) {
		const s = signupByKey(event.id, key);
		if (!s) redirect(303, url.pathname);
		rememberSignup(cookies, s);
		if (s.emailConfirmedAt) redirect(303, url.pathname);
		await sendDoneIfReady(url.origin, event, confirmEmail(event, s));
		redirect(303, `${url.pathname}?confirmed=1`);
	}

	let signup = currentSignup(cookies, event.id);
	if (signup && !signup.completedAt && !signup.paid) signup = refreshHold(event, signup);
	if (!signup && (!event.signupOpen || results)) redirect(303, `/events/${event.slug}`);

	const steps = stepsFor(event, signup);
	const now = new Date();
	return {
		event: {
			slug: event.slug,
			name: event.name,
			startsAt: event.startsAt,
			endsAt: event.endsAt,
			venue: event.venue,
			venueUrl: event.venueUrl,
			capacity: event.capacity
		},
		form: formOf(event),
		deposit: depositOf(event),
		/** Cancel by then to get the deposit back (null: no rule). */
		refundBy:
			event.depositAmount === null ? null : refundDeadline(event.startsAt, event.refundDays),
		spotsLeft: spotsLeft(event),
		steps,
		step: stepToShow(steps, signup, url.searchParams.get('step')),
		/** Just came back through the confirmation link. */
		/** Signing up again after cancelling is possible while signups are open. */
		canRejoin: event.signupOpen && !results,
		/** Who to contact about a deposit refund (SITE_ADMIN_EMAIL, else the reply-to address). */
		contact: siteEnv.adminEmail || null,
		confirmedNow: url.searchParams.has('confirmed') && !!signup?.emailConfirmedAt,
		signup: signup && {
			name: signup.name,
			email: signup.email,
			phone: signup.phone ?? '',
			answers: parseAnswers(signup),
			newsletter: signup.newsletter,
			waitlist: signup.waitlist,
			state: signupState(signup, now),
			holdUntil: signup.holdUntil,
			emailConfirmed: !!signup.emailConfirmedAt,
			paid: signup.paid || !!signup.proofAt,
			refundDue: signup.refundDue,
			hasProof: !!signup.proofRef
		}
	};
};

const go = (slug: string, step: Step) => redirect(303, `/events/${slug}/signup?step=${step}`);

const ContactBody = z.object({
	email: z.string().trim().toLowerCase().email('Enter a valid email').max(200),
	name: z.string().trim().min(1, 'Tell us your full name').max(80),
	phone: z.string().trim().min(2, 'Add a phone number or KakaoTalk ID').max(60)
});

function requireSignup(cookies: Parameters<typeof currentSignup>[0], eventId: string) {
	const s = currentSignup(cookies, eventId);
	if (!s) error(409, 'Start with your contact details');
	return s;
}

export const actions: Actions = {
	contact: async ({ request, params, cookies, url }) => {
		const { event, results } = openEvent(params.slug);
		const values = Object.fromEntries(await request.formData()) as Record<string, string>;
		const parsed = ContactBody.safeParse(values);
		if (!parsed.success)
			return fail(400, { values, error: parsed.error.issues[0]?.message ?? 'Check the form' });
		const mine = currentSignup(cookies, event.id);
		if ((!event.signupOpen || results) && !mine)
			return fail(409, { values, error: 'Signups for this event are closed.' });
		const { signup, existing } = startSignup(event, parsed.data, mine);
		if (existing) {
			// Not this device's signup: the owner gets their link by email instead.
			await sendResume(url.origin, event, signup);
			return { values, sentTo: signup.email };
		}
		rememberSignup(cookies, signup);
		await sendConfirm(url.origin, event, signup);
		const steps = stepsFor(event, signup);
		go(event.slug, steps[1] ?? 'done');
	},

	about: async ({ request, params, cookies }) => {
		const { event } = openEvent(params.slug);
		const signup = requireSignup(cookies, event.id);
		const raw = Object.fromEntries(await request.formData()) as Record<string, string>;
		const result = validateAbout(formOf(event), raw);
		if (!result.ok) return fail(400, { error: result.error, raw });
		saveAbout(signup, result.answers);
		const steps = stepsFor(event, signup);
		go(event.slug, steps[steps.indexOf('about') + 1] ?? 'done');
	},

	before: async ({ request, params, cookies, url }) => {
		const { event } = openEvent(params.slug);
		const signup = requireSignup(cookies, event.id);
		const form = formOf(event);
		const data = await request.formData();
		const missing = form.confirmations.find((c) => data.get(`confirm_${c.id}`) !== 'yes');
		if (missing) return fail(400, { error: `Please confirm: ${missing.title}` });
		const newsletterRaw = data.get('newsletter');
		if (form.askNewsletter && newsletterRaw !== 'yes' && newsletterRaw !== 'no') {
			return fail(400, { error: 'Choose whether we may email you when the next signup opens' });
		}
		const newsletter = form.askNewsletter ? newsletterRaw === 'yes' : null;
		const updated = saveConfirmations(
			event,
			signup,
			form.confirmations.map((c) => c.id),
			newsletter
		);
		await sendDoneIfReady(url.origin, event, updated);
		go(event.slug, needsDeposit(event, updated) ? 'deposit' : 'done');
	},

	deposit: async ({ request, params, cookies, url }) => {
		const { event } = openEvent(params.slug);
		const signup = requireSignup(cookies, event.id);
		const file = (await request.formData()).get('proof');
		if (!(file instanceof File) || file.size === 0) {
			// Already sent one: keep it and move on.
			if (signup.proofRef) go(event.slug, 'done');
			return fail(400, { error: 'Add a screenshot of your transfer' });
		}
		if (file.size > PROOF_MAX_BYTES)
			return fail(400, { error: 'The screenshot must be at most 10 MB' });
		try {
			const saved = await saveProof(signup, new Uint8Array(await file.arrayBuffer()));
			await sendDoneIfReady(url.origin, event, saved);
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : 'Could not save the screenshot'
			});
		}
		go(event.slug, 'done');
	},

	/** Only when the event doesn't require a screenshot. */
	withoutProof: async ({ params, cookies, url }) => {
		const { event } = openEvent(params.slug);
		const signup = requireSignup(cookies, event.id);
		if (event.proofRequired)
			return fail(400, { error: 'Please add a screenshot of your transfer' });
		await sendDoneIfReady(url.origin, event, finishWithoutProof(signup));
		go(event.slug, 'done');
	},

	/** Send the confirmation email again (at most once a minute). */
	resend: async ({ params, cookies, url }) => {
		const { event } = openEvent(params.slug);
		const signup = requireSignup(cookies, event.id);
		const sent = await sendConfirm(url.origin, event, signup);
		return sent ? { resent: true } : { throttled: true };
	},

	/** "I can't come": the seat is free again; the person and the organisers get an email. */
	cancel: async ({ params, cookies, url }) => {
		const { event } = openEvent(params.slug);
		const signup = requireSignup(cookies, event.id);
		if (!signup.cancelledAt) await sendCancelled(url.origin, event, cancelSignup(event, signup));
		redirect(303, `/events/${event.slug}/signup`);
	},

	/** Signing up again after cancelling. */
	rejoin: async ({ params, cookies, url }) => {
		const { event, results } = openEvent(params.slug);
		const signup = requireSignup(cookies, event.id);
		if (!event.signupOpen || results)
			return fail(409, { error: 'Signups for this event are closed.' });
		const back = rejoin(event, signup);
		if (!back.emailConfirmedAt) await sendConfirm(url.origin, event, back);
		redirect(303, `/events/${event.slug}/signup`);
	},

	/** "Not you?": forget this device's signup and start fresh. */
	restart: async ({ params, cookies }) => {
		const { event } = openEvent(params.slug);
		forgetSignup(cookies, event.id);
		go(event.slug, 'contact');
	}
};
