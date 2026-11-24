import { z } from 'zod';

/*
Per-event signup form, edited by admins. The flow is fixed: 1 contact (built in), 2 "about you"
(questions), 3 "before you come" (confirmations + newsletter), 4 deposit (when the event asks
for one), then done. Answers are stored per signup, keyed by question id.
*/

export const Question = z.object({
	id: z.string().regex(/^[a-z0-9_]{1,40}$/),
	/** choice: pick one option (optionally "Other" with text). text: free text. */
	kind: z.enum(['choice', 'text']),
	label: z.string().trim().min(1).max(200),
	help: z.string().trim().max(300).optional(),
	options: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
	allowOther: z.boolean().default(false),
	required: z.boolean().default(true)
});
export type Question = z.infer<typeof Question>;

/** A checkbox people must tick before they come ("I will bring a laptop"). */
export const Confirmation = z.object({
	id: z.string().regex(/^[a-z0-9_]{1,40}$/),
	title: z.string().trim().min(1).max(100),
	help: z.string().trim().max(300).optional(),
	label: z.string().trim().min(1).max(200)
});
export type Confirmation = z.infer<typeof Confirmation>;

export const SignupForm = z.object({
	about: z.array(Question).max(15),
	confirmations: z.array(Confirmation).max(10),
	/** Ask "email me when the next signup opens?" (yes / no, no default). */
	askNewsletter: z.boolean()
});
export type SignupForm = z.infer<typeof SignupForm>;

export const Deposit = z.object({
	/** In won. Null: no deposit step. */
	amount: z.number().int().positive().nullable(),
	/** Where to send it, e.g. the bank account. */
	instructions: z.string().trim().max(1000),
	/** What happens to it, e.g. "returned at the door or swapped for a drink". */
	note: z.string().trim().max(500),
	proofRequired: z.boolean(),
	/** Cancel at least this many days before the start to get the deposit back; null: no rule. */
	refundDays: z.number().int().min(0).max(60).nullable(),
	/** How long a seat is held before the deposit proof must be in. */
	holdHours: z
		.number()
		.int()
		.min(1)
		.max(24 * 14)
});
export type Deposit = z.infer<typeof Deposit>;

/** Answers: question id -> chosen option / text ("other:<text>" for Other). */
export const Answers = z.record(z.string(), z.string().max(500));
export type Answers = z.infer<typeof Answers>;

export const OTHER_PREFIX = 'other:';

export const DEFAULT_FORM: SignupForm = {
	about: [
		{
			id: 'role',
			kind: 'choice',
			label: 'What do you do?',
			options: [
				'Founder or business owner',
				'Freelancer',
				'Employee',
				'Student',
				'Teacher',
				'Between things'
			],
			allowOther: true,
			required: true
		},
		{
			id: 'ai_experience',
			kind: 'choice',
			label: 'Have you built anything with AI before?',
			options: [
				'Never',
				'I have tried Lovable or a similar tool once or twice',
				'I build with AI tools regularly',
				'I am a developer'
			],
			allowOther: false,
			required: true
		},
		{
			id: 'first_time',
			kind: 'choice',
			label: 'Is this your first time at one of our events?',
			options: [
				'Yes, first time',
				'I have been to one event',
				'I have been to more than one event'
			],
			allowOther: false,
			required: true
		},
		{
			id: 'heard_from',
			kind: 'choice',
			label: 'How did you hear about this?',
			options: [
				'Website or newsletter',
				'Instagram',
				'Facebook',
				'KakaoTalk group',
				'LinkedIn',
				'BASE21',
				'A friend'
			],
			allowOther: true,
			required: true
		}
	],
	confirmations: [
		{ id: 'laptop', title: 'Laptop', label: 'I will bring a laptop and a charger' },
		{
			id: 'lovable',
			title: 'Lovable account',
			help: 'Free to create at lovable.dev. You can do it right away.',
			label: 'I will create a free Lovable account before the event'
		},
		{
			id: 'cancel',
			title: 'If I cannot make it',
			label: 'I will let you know so my seat can go to the waitlist'
		},
		{
			id: 'photos',
			title: 'Photos',
			help: 'We take photos and short videos at the event for our website and partners.',
			label: 'Understood'
		}
	],
	askNewsletter: true
};

export const DEFAULT_DEPOSIT: Deposit = {
	amount: null,
	instructions: '',
	note: '',
	proofRequired: true,
	refundDays: null,
	holdHours: 24
};

/** Human answer for display/CSV ("Other: …" spelled out). */
export function answerText(value: string | undefined): string {
	if (!value) return '';
	return value.startsWith(OTHER_PREFIX) ? `Other: ${value.slice(OTHER_PREFIX.length)}` : value;
}

/** Answers for a step's questions, or the first problem. */
export function validateAbout(
	form: SignupForm,
	raw: Record<string, string>
): { ok: true; answers: Answers } | { ok: false; error: string } {
	const answers: Answers = {};
	for (const q of form.about) {
		let value = (raw[q.id] ?? '').trim();
		if (q.kind === 'choice' && value === '__other') {
			const other = (raw[`${q.id}__other`] ?? '').trim();
			value = other ? `${OTHER_PREFIX}${other}` : '';
		}
		if (
			q.kind === 'choice' &&
			value &&
			!value.startsWith(OTHER_PREFIX) &&
			!q.options.includes(value)
		) {
			return { ok: false, error: `Pick one of the options for “${q.label}”` };
		}
		if (q.kind === 'choice' && value.startsWith(OTHER_PREFIX) && !q.allowOther) {
			return { ok: false, error: `Pick one of the options for “${q.label}”` };
		}
		if (q.required && !value) return { ok: false, error: `Please answer “${q.label}”` };
		if (value) answers[q.id] = value.slice(0, 500);
	}
	return { ok: true, answers };
}
