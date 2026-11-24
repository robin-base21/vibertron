import { sql } from 'drizzle-orm';
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch() * 1000)`);

/** An event page: upcoming (signups) and, once Vibertron publishes, past (results). */
export const events = sqliteTable('events', {
	id: text('id').primaryKey(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	tagline: text('tagline'),
	/** Plain text; blank lines separate paragraphs. */
	description: text('description'),
	startsAt: integer('starts_at', { mode: 'timestamp_ms' }),
	endsAt: integer('ends_at', { mode: 'timestamp_ms' }),
	venue: text('venue'),
	/** Map link for the venue (Naver/Kakao/Google Maps), opened in a new tab. */
	venueUrl: text('venue_url'),
	/** Max confirmed signups; further signups go on the waitlist. Null: no limit. */
	capacity: integer('capacity'),
	/** Free text, e.g. "₩10,000 by bank transfer". Payments are tracked by hand (signups.paid). */
	priceNote: text('price_note'),
	signupOpen: integer('signup_open', { mode: 'boolean' }).notNull().default(true),
	/** SignupForm JSON (questions and confirmations); null uses the default template. */
	form: text('form'),
	/** Deposit to reserve a seat, in won; null: no deposit step. */
	depositAmount: integer('deposit_amount'),
	depositInstructions: text('deposit_instructions'),
	depositNote: text('deposit_note'),
	proofRequired: integer('proof_required', { mode: 'boolean' }).notNull().default(true),
	/** Cancel at least this many days before the start to get the deposit back; null: no rule. */
	refundDays: integer('refund_days'),
	/** Hours a seat stays held after step 1 without a finished signup (deposit proof). */
	holdHours: integer('hold_hours').notNull().default(24),
	/** The event the home page hero promotes (at most one; otherwise the next upcoming). */
	featured: integer('featured', { mode: 'boolean' }).notNull().default(false),
	/** Last time the subscribers were emailed about this event. */
	announcedAt: integer('announced_at', { mode: 'timestamp_ms' }),
	/** The flyer shown on the event page (one of its generated flyers). */
	flyerId: text('flyer_id'),
	/** Hidden from the public pages until published. */
	published: integer('published', { mode: 'boolean' }).notNull().default(false),
	/** Links results pushed from Vibertron to this page (its event id, or its slug set by an admin). */
	sourceEventId: text('vibertron_event_id').unique(),
	sourceSlug: text('vibertron_slug'),
	createdAt: createdAt()
});

export const signups = sqliteTable(
	'signups',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		email: text('email').notNull(),
		/** Phone or KakaoTalk ID, for changes on the day. */
		phone: text('phone'),
		/** Answers JSON: question id -> answer. Confirmations are stored as "yes". */
		answers: text('answers').notNull().default('{}'),
		/** "Email me when the next signup opens"; null until answered. */
		newsletter: integer('newsletter', { mode: 'boolean' }),
		/** Furthest step reached (1 contact, 2 about, 3 before you come, 4 deposit). */
		step: integer('step').notNull().default(1),
		waitlist: integer('waitlist', { mode: 'boolean' }).notNull().default(false),
		/** Cancelled by the person (kept so the organiser sees it; the seat is free again). */
		cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
		/** Set on cancelling a paid deposit: true in time for a refund, false too late, null no rule. */
		refundDue: integer('refund_due', { mode: 'boolean' }),
		/** The organiser sent the deposit back. */
		refundedAt: integer('refunded_at', { mode: 'timestamp_ms' }),
		/** Clicked the link in the confirmation email; until then the seat is only held briefly. */
		emailConfirmedAt: integer('email_confirmed_at', { mode: 'timestamp_ms' }),
		/** Seat saved for good (free events: once the email is confirmed, no hold that runs out). */
		seatedAt: integer('seated_at', { mode: 'timestamp_ms' }),
		/** Seat held until then for an unfinished signup; afterwards the seat is free again. */
		holdUntil: integer('hold_until', { mode: 'timestamp_ms' }),
		/** Payment screenshot in SITE_DATA_DIR/proofs. */
		proofRef: text('proof_ref'),
		proofAt: integer('proof_at', { mode: 'timestamp_ms' }),
		/** All steps done (incl. the deposit proof when required): the seat is theirs. */
		completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
		/** Secret for resuming the signup (cookie, or a link an admin sends). */
		token: text('token').notNull().default(''),
		/** Opted in (unticked by default) to hear about future events. */
		marketingConsent: integer('marketing_consent', { mode: 'boolean' }).notNull().default(false),
		/** Marked by an admin, whatever the payment route (bank transfer, cash, ...). */
		paid: integer('paid', { mode: 'boolean' }).notNull().default(false),
		paidAt: integer('paid_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('signups_event_email_idx').on(t.eventId, t.email),
		index('signups_event_idx').on(t.eventId)
	]
);

/** "Stay in the loop" list: explicit opt-in only, with when it happened. */
export const subscribers = sqliteTable('subscribers', {
	email: text('email').primaryKey(),
	consentAt: integer('consent_at', { mode: 'timestamp_ms' }).notNull(),
	source: text('source').notNull()
});

/** The latest results pushed by Vibertron for an event (PublishPayload JSON). */
export const results = sqliteTable('results', {
	eventId: text('event_id')
		.primaryKey()
		.references(() => events.id, { onDelete: 'cascade' }),
	sourceEventId: text('vibertron_event_id').notNull().unique(),
	payload: text('payload').notNull(),
	publishedAt: integer('published_at', { mode: 'timestamp_ms' }).notNull()
});

/**
 * Admin curation of showcased projects, kept apart from the pushed results so a re-publish from
 * Vibertron doesn't undo it. projectId is Vibertron's project id.
 */
export const projectCuration = sqliteTable(
	'project_curation',
	{
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		projectId: text('project_id').notNull(),
		/** Off the site even though the author agreed (spam, broken link, duplicate). */
		hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
		/** Pinned to the top of the showcase and the home page. */
		featuredAt: integer('featured_at', { mode: 'timestamp_ms' }),
		/** Site-only text corrections of a published project; null keeps the published value. */
		name: text('name'),
		tagline: text('tagline'),
		author: text('author'),
		link: text('link')
	},
	(t) => [primaryKey({ columns: [t.eventId, t.projectId] })]
);

/** Projects added by hand on the site (e.g. events that didn't run in the event app). */
export const manualProjects = sqliteTable(
	'manual_projects',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		tagline: text('tagline'),
		author: text('author').notNull(),
		teamName: text('team_name'),
		link: text('link'),
		/** Slides PDF in SITE_DATA_DIR/manual-decks/<eventId>/. */
		deckRef: text('deck_ref'),
		createdAt: createdAt()
	},
	(t) => [index('manual_projects_event_idx').on(t.eventId)]
);

/** Every email the site sends (or, without RESEND_API_KEY, only logs), newest first in the admin. */
export const emails = sqliteTable(
	'emails',
	{
		id: text('id').primaryKey(),
		/** confirm | resume | done | promoted | paid | announce */
		kind: text('kind').notNull(),
		to: text('to').notNull(),
		subject: text('subject').notNull(),
		html: text('html').notNull(),
		text: text('text').notNull(),
		eventId: text('event_id'),
		signupId: text('signup_id'),
		/** sent | failed | logged (no API key configured) */
		status: text('status').notNull(),
		providerId: text('provider_id'),
		error: text('error'),
		createdAt: createdAt()
	},
	(t) => [index('emails_signup_idx').on(t.signupId), index('emails_created_idx').on(t.createdAt)]
);

/** Preview image (og:image) of a project link, fetched once and stored in SITE_DATA_DIR/previews. */
export const linkPreviews = sqliteTable('link_previews', {
	url: text('url').primaryKey(),
	/** File name in previews/; null when the page has no usable image. */
	imageRef: text('image_ref'),
	/** ok | none | error */
	status: text('status').notNull(),
	error: text('error'),
	fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull()
});

/** AI-generated flyers of an event (files in SITE_DATA_DIR/flyers/<eventId>/). */
export const flyers = sqliteTable(
	'flyers',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		/** Generated image file. */
		imageRef: text('image_ref').notNull(),
		/** An uploaded image it was made from (file next to the flyer). */
		referenceRef: text('reference_ref'),
		/** An earlier flyer (any event) it was made from. */
		sourceFlyerId: text('source_flyer_id'),
		/** fresh: new design | style: inspired by the image | update: same design, new details */
		mode: text('mode').notNull().default('fresh'),
		prompt: text('prompt'),
		aspect: text('aspect').notNull(),
		model: text('model').notNull(),
		createdAt: createdAt()
	},
	(t) => [index('flyers_event_idx').on(t.eventId)]
);
