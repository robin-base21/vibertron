import { z } from 'zod';
import type { AiSection } from '$lib/aiFill';
import { SignupForm } from '$lib/signupForm';
import { TIME_ZONE, toLocalInput } from '$lib/time';
import { aiJson } from './ai';

// "Fill out with AI" on the event form: the admin's prompt + the current values in, new values for the
// ticked sections out. Nothing is saved; the form shows the values for review.

const str = (max: number) => ({ type: ['string', 'null'], maxLength: max });
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const SECTION_SCHEMA: Record<AiSection, { props: Record<string, unknown>; zod: z.ZodRawShape }> = {
	basics: {
		props: { name: { type: 'string', maxLength: 100 }, tagline: str(200) },
		zod: { name: z.string().trim().min(1).max(100), tagline: z.string().trim().max(200).nullable() }
	},
	when: {
		props: {
			startsAt: { type: ['string', 'null'], description: `YYYY-MM-DDTHH:mm in ${TIME_ZONE}` },
			endsAt: { type: ['string', 'null'], description: `YYYY-MM-DDTHH:mm in ${TIME_ZONE}` },
			venue: str(200)
		},
		zod: {
			startsAt: z.string().regex(LOCAL).nullable(),
			endsAt: z.string().regex(LOCAL).nullable(),
			venue: z.string().trim().max(200).nullable()
		}
	},
	seats: {
		props: {
			capacity: { type: ['integer', 'null'], description: 'null: unlimited' },
			free: { type: 'boolean' },
			priceNote: {
				...str(120),
				description: 'Shown publicly when not free, e.g. "₩10,000 deposit"'
			},
			depositAmount: { type: ['integer', 'null'], description: 'Won; null: no deposit step' },
			depositNote: { ...str(500), description: 'What happens to the deposit' }
		},
		zod: {
			capacity: z.number().int().min(1).max(10_000).nullable(),
			free: z.boolean(),
			priceNote: z.string().trim().max(120).nullable(),
			depositAmount: z.number().int().min(1).max(10_000_000).nullable(),
			depositNote: z.string().trim().max(500).nullable()
		}
	},
	description: {
		props: {
			description: {
				type: 'string',
				maxLength: 6000,
				description: 'Plain text; blank lines between paragraphs'
			}
		},
		zod: { description: z.string().trim().max(10_000) }
	},
	form: {
		props: {
			questions: {
				type: 'array',
				maxItems: 10,
				items: {
					type: 'object',
					additionalProperties: false,
					required: ['label', 'kind', 'options', 'allowOther', 'required'],
					properties: {
						label: { type: 'string' },
						kind: { type: 'string', enum: ['choice', 'text'] },
						options: { type: 'array', items: { type: 'string' }, maxItems: 10 },
						allowOther: { type: 'boolean' },
						required: { type: 'boolean' }
					}
				}
			},
			confirmations: {
				type: 'array',
				maxItems: 6,
				items: {
					type: 'object',
					additionalProperties: false,
					required: ['title', 'label'],
					properties: { title: { type: 'string' }, label: { type: 'string' } }
				}
			}
		},
		zod: {
			questions: z
				.array(
					z.object({
						label: z.string().trim().min(1).max(200),
						kind: z.enum(['choice', 'text']),
						options: z.array(z.string().trim().min(1).max(100)).max(20),
						allowOther: z.boolean(),
						required: z.boolean()
					})
				)
				.max(15),
			confirmations: z
				.array(
					z.object({
						title: z.string().trim().min(1).max(100),
						label: z.string().trim().min(1).max(200)
					})
				)
				.max(10)
		}
	}
};

export const FillRequest = z.object({
	prompt: z.string().trim().max(4000),
	sections: z.array(z.enum(['basics', 'when', 'seats', 'description', 'form'])).min(1),
	/** The form as it is now (input name -> value). */
	current: z.record(z.string(), z.unknown()),
	signupForm: SignupForm.optional()
});

export type FillResult = {
	values: Record<string, string | number | boolean | null>;
	signupForm?: SignupForm;
};

const SYSTEM = `You fill in the event form of OurBusan.vibe, a community in Busan, Korea that runs
"vibe coding" events: people build something with AI tools in one afternoon (or a weekend), in teams,
then pitch and vote. Audience: founders, freelancers, employees, students, locals and expats. Write in
English: warm, concrete, short sentences, no hype words, no emoji.

Rules:
- Fill only the fields in the schema. Use what the organiser wrote; keep current values that still fit
  and improve them when asked.
- Never invent facts you weren't given: no links, bank details, sponsors, prizes, addresses or names.
  If a date, venue or price is unknown, keep the current value (or null).
- Dates are local ${TIME_ZONE} time as YYYY-MM-DDTHH:mm. "Next Saturday" etc. counts from today.
- free=true means no price and no deposit (depositAmount null). With a deposit, priceNote says it.
- Signup questions: short, multiple choice where possible, useful for forming teams (role, AI
  experience, what they want to build). Confirmations are things people must agree to before coming
  (bring a laptop, photos may be taken, ...).`;

export async function fillEvent(req: z.infer<typeof FillRequest>): Promise<FillResult> {
	const props: Record<string, unknown> = {};
	const shape: z.ZodRawShape = {};
	for (const s of req.sections) {
		Object.assign(props, SECTION_SCHEMA[s].props);
		Object.assign(shape, SECTION_SCHEMA[s].zod);
	}
	const today = toLocalInput(new Date()).slice(0, 10);
	const current = {
		...req.current,
		...(req.sections.includes('form') && req.signupForm
			? {
					signupQuestions: req.signupForm.about.map(({ label, kind, options }) => ({
						label,
						kind,
						options
					})),
					confirmations: req.signupForm.confirmations.map(({ title, label }) => ({ title, label }))
				}
			: {})
	};
	const out = await aiJson({
		name: 'event_fields',
		jsonSchema: {
			type: 'object',
			additionalProperties: false,
			required: Object.keys(props),
			properties: props
		},
		validate: z.object(shape),
		messages: [
			{ role: 'system', content: SYSTEM },
			{
				role: 'user',
				content: `Today is ${today}.\n\nCurrent form values:\n${JSON.stringify(current, null, 2)}\n\nOrganiser's request:\n${req.prompt || '(none: write good values from what is there)'}`
			}
		]
	});

	const { questions, confirmations, ...rest } = out as Record<string, unknown> & {
		questions?: {
			label: string;
			kind: 'choice' | 'text';
			options: string[];
			allowOther: boolean;
			required: boolean;
		}[];
		confirmations?: { title: string; label: string }[];
	};
	const result: FillResult = { values: rest as FillResult['values'] };
	if (rest.free === true) result.values.depositAmount = null;
	if (questions && confirmations) {
		const id = (p: string, i: number) => `${p}_ai${Date.now().toString(36).slice(-4)}${i}`;
		result.signupForm = {
			about: questions.map((q, i) => ({
				id: id('q', i),
				kind: q.kind,
				label: q.label,
				options: q.kind === 'choice' ? q.options : [],
				allowOther: q.kind === 'choice' && q.allowOther,
				required: q.required
			})),
			confirmations: confirmations.map((c, i) => ({ id: id('c', i), ...c })),
			askNewsletter: req.signupForm?.askNewsletter ?? true
		};
	}
	return result;
}
