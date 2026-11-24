import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { signupState } from '$lib/seats';
import { db } from '$lib/server/db';
import { events, results, signups } from '$lib/server/db/schema';
import { parseEventForm } from '$lib/server/eventForm';
import { deleteEvent } from '$lib/server/events';
import { announce, audienceOf } from '$lib/server/announce';
import { mailConfigured } from '$lib/server/mail';
import { siteEnv } from '$lib/server/env';
import { AiError, aiConfigured } from '$lib/server/ai';
import {
	FLYER_ASPECTS,
	FLYER_UPLOAD_MAX_BYTES,
	REFERENCE_MAX_BYTES,
	addOwnFlyer,
	deleteFlyer,
	flyerById,
	flyerSources,
	flyersOf,
	generateFlyer,
	useFlyer,
	type FlyerAspect,
	type FlyerSource
} from '$lib/server/flyers';
import { sendDoneIfReady, sendPaid, sendPromoted, signupLink } from '$lib/server/signupMail';
import { confirmEmail, formOf, parseAnswers, promote } from '$lib/server/signups';
import type { Actions, PageServerLoad } from './$types';

function loadEvent(id: string) {
	const event = db().select().from(events).where(eq(events.id, id)).get();
	if (!event) error(404, 'Event not found');
	return event;
}

export const load: PageServerLoad = ({ params, url }) => {
	const event = loadEvent(params.id);
	const d = db();
	const now = new Date();
	return {
		event,
		signupForm: formOf(event),
		signups: d
			.select()
			.from(signups)
			.where(eq(signups.eventId, event.id))
			.orderBy(asc(signups.createdAt))
			.all()
			.map((s) => ({
				id: s.id,
				name: s.name,
				email: s.email,
				phone: s.phone,
				createdAt: s.createdAt,
				paid: s.paid,
				paidAt: s.paidAt,
				waitlist: s.waitlist,
				newsletter: s.newsletter,
				step: s.step,
				holdUntil: s.holdUntil,
				emailConfirmed: !!s.emailConfirmedAt,
				refundDue: s.refundDue,
				refundedAt: s.refundedAt,
				hasProof: !!s.proofRef,
				completed: !!s.completedAt,
				proofAt: s.proofAt,
				state: signupState(s, now),
				answers: parseAnswers(s),
				/** Link the organiser can send so the person continues their signup (e.g. after leaving the waitlist). */
				resumeUrl: signupLink(url.origin, event, s)
			})),
		mail: { configured: mailConfigured(), audience: audienceOf(event).length },
		ai: aiConfigured(),
		flyers: flyersOf(event.id).map((f) => ({
			id: f.id,
			prompt: f.prompt,
			aspect: f.aspect,
			createdAt: f.createdAt,
			mode: f.mode
		})),
		/** Earlier flyers of every event, to start a new one from. */
		flyerSources: flyerSources(),
		resultsAt:
			d.select({ at: results.publishedAt }).from(results).where(eq(results.eventId, event.id)).get()
				?.at ?? null
	};
};

async function signupOf(request: Request, eventId: string) {
	const id = String((await request.formData()).get('id') ?? '');
	return db()
		.select()
		.from(signups)
		.where(and(eq(signups.id, id), eq(signups.eventId, eventId)))
		.get();
}

export const actions: Actions = {
	save: async ({ request, params }) => {
		const event = loadEvent(params.id);
		const form = await parseEventForm(request, event.id);
		if (!form.ok) return fail(400, { error: form.error });
		db().update(events).set(form.values).where(eq(events.id, event.id)).run();
		// A clean URL to come back to (no resubmit on reload), on the same tab.
		redirect(303, `/admin/events/${event.id}?tab=details&saved=1`);
	},
	/** Payment is tracked by hand: check the bank app, then mark it. */
	paid: async ({ request, params, url }) => {
		const event = loadEvent(params.id);
		const row = await signupOf(request, params.id);
		if (!row) return fail(404, { error: 'Signup not found' });
		const paid = !row.paid;
		db()
			.update(signups)
			.set({ paid, paidAt: paid ? new Date() : null })
			.where(eq(signups.id, row.id))
			.run();
		if (paid) await sendPaid(url.origin, event, row);
		return {};
	},
	/** Off the waitlist: with a deposit due they get a fresh hold and need to finish step 4. */
	waitlist: async ({ request, params, url }) => {
		const event = loadEvent(params.id);
		const row = await signupOf(request, event.id);
		if (!row) return fail(404, { error: 'Signup not found' });
		if (row.waitlist) await sendPromoted(url.origin, event, promote(event, row));
		else
			db()
				.update(signups)
				.set({ waitlist: true, holdUntil: null })
				.where(eq(signups.id, row.id))
				.run();
		return {};
	},
	/** The deposit of a cancelled signup was sent back (toggle). */
	refunded: async ({ request, params }) => {
		const row = await signupOf(request, params.id);
		if (!row?.cancelledAt) return fail(404, { error: 'Signup not found' });
		db()
			.update(signups)
			.set({ refundedAt: row.refundedAt ? null : new Date() })
			.where(eq(signups.id, row.id))
			.run();
		return {};
	},
	/** Vouch for the address by hand (e.g. confirmed over KakaoTalk). */
	confirm: async ({ request, params, url }) => {
		const event = loadEvent(params.id);
		const row = await signupOf(request, event.id);
		if (!row) return fail(404, { error: 'Signup not found' });
		await sendDoneIfReady(url.origin, event, confirmEmail(event, row));
		return {};
	},
	/** Email this event to the subscriber list. */
	announce: async ({ params, url }) => {
		const event = loadEvent(params.id);
		if (!event.published) return fail(400, { error: 'Publish the event before announcing it' });
		return { announced: await announce(url.origin, event) };
	},
	/** AI flyer from the event details + a style reference + an optional prompt. */
	/**
	 * AI flyer from this event's details. Starting point: nothing, an earlier flyer (any event) or an
	 * uploaded image; used either as a design to update ("update") or as a style reference ("style").
	 */
	flyer: async ({ request, params }) => {
		const event = loadEvent(params.id);
		const data = await request.formData();
		const from = String(data.get('from') ?? 'none');
		const mode = data.get('mode') === 'style' ? 'style' : 'update';
		const prompt = String(data.get('prompt') ?? '')
			.trim()
			.slice(0, 1000);
		let source: FlyerSource = null;
		let aspect = String(data.get('aspect') ?? '4:5');
		if (from === 'upload') {
			const file = data.get('reference');
			if (!(file instanceof File) || file.size === 0)
				return fail(400, { flyerError: 'Choose an image to upload' });
			if (file.size > REFERENCE_MAX_BYTES)
				return fail(400, { flyerError: 'The image must be at most 10 MB' });
			source = { kind: 'upload', bytes: new Uint8Array(await file.arrayBuffer()) };
		} else if (from.startsWith('flyer:')) {
			const base = flyerById(from.slice(6));
			if (!base) return fail(400, { flyerError: 'That flyer is gone; pick another one' });
			source = { kind: 'flyer', id: base.id };
			if (aspect === 'same') aspect = base.aspect;
		}
		// An uploaded flyer has no known format: fall back to Instagram portrait.
		if (aspect === 'same' || aspect === 'own') aspect = '4:5';
		if (!(FLYER_ASPECTS as readonly string[]).includes(aspect))
			return fail(400, { flyerError: 'Pick a format' });
		try {
			const made = await generateFlyer(event, {
				host: siteEnv.publicHost,
				source,
				mode,
				prompt,
				aspect: aspect as FlyerAspect
			});
			// The first flyer goes on the event page right away.
			if (!event.flyerId) useFlyer(event, made.id);
			return { flyerMade: made.id };
		} catch (err) {
			if (err instanceof AiError || err instanceof Error)
				return fail(502, { flyerError: err.message });
			throw err;
		}
	},
	/** A finished flyer, no AI. */
	uploadFlyer: async ({ request, params }) => {
		const event = loadEvent(params.id);
		const file = (await request.formData()).get('reference');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { uploadError: 'Choose an image' });
		if (file.size > FLYER_UPLOAD_MAX_BYTES)
			return fail(400, { uploadError: 'The image must be at most 20 MB' });
		try {
			const made = await addOwnFlyer(event, new Uint8Array(await file.arrayBuffer()));
			if (!event.flyerId) useFlyer(event, made.id);
			return { flyerMade: made.id };
		} catch (err) {
			return fail(400, { uploadError: err instanceof Error ? err.message : 'Upload failed' });
		}
	},
	useFlyer: async ({ request, params }) => {
		const event = loadEvent(params.id);
		const id = String((await request.formData()).get('id') ?? '');
		useFlyer(event, id || null);
		return {};
	},
	deleteFlyer: async ({ request, params }) => {
		const event = loadEvent(params.id);
		await deleteFlyer(event, String((await request.formData()).get('id') ?? ''));
		return {};
	},
	remove: async ({ request, params }) => {
		const row = await signupOf(request, params.id);
		if (row) db().delete(signups).where(eq(signups.id, row.id)).run();
		return {};
	},
	delete: async ({ params }) => {
		await deleteEvent(params.id);
		redirect(303, '/admin');
	}
};
