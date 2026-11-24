import { z } from 'zod';
import { SignupForm } from '$lib/signupForm';
import { fromLocalInput } from '$lib/time';
import { freeSlug, slugify } from './events';

const optional = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.transform((v) => v || null);

const EventFields = z.object({
	name: z.string().trim().min(1, 'Name is required').max(100),
	slug: z.string().trim().max(60),
	tagline: optional(200),
	description: optional(10_000),
	startsAt: z.string(),
	endsAt: z.string(),
	venue: optional(200),
	venueUrl: z
		.string()
		.trim()
		.max(500)
		.refine(
			(v) => !v || /^https?:\/\/\S+$/i.test(v),
			'The location link must start with http:// or https://'
		)
		.transform((v) => v || null),
	capacity: z.string().trim(),
	priceNote: optional(120),
	sourceSlug: optional(60),
	signupOpen: z.literal('on').optional(),
	published: z.literal('on').optional(),
	/** Free event toggle: price "Free", no deposit step. */
	free: z.literal('on').optional(),
	depositAmount: z.string().trim(),
	depositInstructions: optional(1000),
	depositNote: optional(500),
	proofRequired: z.literal('on').optional(),
	holdHours: z.coerce.number().int().min(1).max(336),
	refundDays: z
		.string()
		.trim()
		.refine(
			(v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 60),
			'Refund days: a number from 0 to 60'
		)
		.transform((v) => (v === '' ? null : Number(v))),
	form: z.string()
});

export type EventFormResult =
	| { ok: true; values: ReturnType<typeof toRow> }
	| { ok: false; error: string; values: Record<string, FormDataEntryValue> };

function toRow(f: z.infer<typeof EventFields>, exceptId?: string) {
	const capacity = f.capacity ? Math.max(1, Math.floor(Number(f.capacity))) : null;
	return {
		name: f.name,
		slug: freeSlug(slugify(f.slug || f.name), exceptId),
		tagline: f.tagline,
		description: f.description,
		startsAt: fromLocalInput(f.startsAt),
		endsAt: fromLocalInput(f.endsAt),
		venue: f.venue,
		venueUrl: f.venueUrl,
		capacity: Number.isFinite(capacity) ? capacity : null,
		priceNote: f.free ? 'Free' : f.priceNote,
		sourceSlug: f.sourceSlug,
		signupOpen: !!f.signupOpen,
		published: !!f.published,
		// Free: no deposit step. The deposit texts are kept for switching back.
		depositAmount:
			!f.free && f.depositAmount ? Math.max(1, Math.floor(Number(f.depositAmount))) || null : null,
		depositInstructions: f.depositInstructions,
		depositNote: f.depositNote,
		proofRequired: !!f.proofRequired,
		holdHours: f.holdHours,
		refundDays: f.refundDays,
		form: f.form
	};
}

export async function parseEventForm(
	request: Request,
	exceptId?: string
): Promise<EventFormResult> {
	const values = Object.fromEntries(await request.formData());
	const parsed = EventFields.safeParse(values);
	if (!parsed.success)
		return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form', values };
	// The form builder posts JSON; empty labels or options are the usual mistakes.
	let raw: unknown;
	try {
		raw = JSON.parse(parsed.data.form || '{}');
	} catch {
		raw = null;
	}
	const form = SignupForm.safeParse(raw);
	if (!form.success)
		return {
			ok: false,
			error: 'Signup form: every question, option and confirmation needs text',
			values
		};
	if (form.data.about.some((q) => q.kind === 'choice' && q.options.length === 0))
		return {
			ok: false,
			error: 'Signup form: “pick one” questions need at least one option',
			values
		};
	return { ok: true, values: toRow({ ...parsed.data, form: JSON.stringify(form.data) }, exceptId) };
}
