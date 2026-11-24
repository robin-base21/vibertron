import {
	PUBLISH_MAX_AGE_MS,
	PublishPayload,
	deckSignatureInput,
	sha256Hex,
	verifyPayload
} from 'common';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db';
import { events, results } from './db/schema';
import { siteEnv } from './env';
import { freeSlug, slugify } from './events';

// Receives Vibertron's "Publish to site" push (contract: common/src/publish.ts).

const SAFE_ID = /^[\w-]{1,64}$/;

export const deckDir = (eventId: string) => resolve(siteEnv.dataDir, 'decks', eventId);
export const deckPath = (eventId: string, projectId: string) =>
	SAFE_ID.test(eventId) && SAFE_ID.test(projectId)
		? join(deckDir(eventId), `${projectId}.pdf`)
		: null;

export class PublishError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

/** Verifies and stores a push (step 1). Returns the site event's slug. */
export async function receiveResults(body: string, signature: string | null): Promise<string> {
	if (!siteEnv.publishSecret)
		throw new PublishError(503, 'Publishing is not set up on the site (SITE_PUBLISH_SECRET)');
	if (!(await verifyPayload(siteEnv.publishSecret, body, signature)))
		throw new PublishError(401, 'Bad signature');
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {
		throw new PublishError(400, 'Body is not JSON');
	}
	const parsed = PublishPayload.safeParse(json);
	if (!parsed.success) throw new PublishError(422, 'Payload does not match the publish contract');
	const payload = parsed.data;
	if (Math.abs(Date.now() - payload.sentAt) > PUBLISH_MAX_AGE_MS)
		throw new PublishError(401, 'Push is too old');
	if (!SAFE_ID.test(payload.event.id)) throw new PublishError(422, 'Bad event id');

	// The page this belongs to: linked before, or prepared by an admin with the Vibertron slug, or new.
	const d = db();
	let event =
		d.select().from(events).where(eq(events.sourceEventId, payload.event.id)).get() ??
		d
			.select()
			.from(events)
			.where(and(eq(events.sourceSlug, payload.event.slug), isNull(events.sourceEventId)))
			.get();
	if (!event) {
		event = d
			.insert(events)
			.values({
				id: crypto.randomUUID(),
				slug: freeSlug(slugify(payload.event.slug || payload.event.name)),
				name: payload.event.name,
				startsAt: payload.event.startedAt ? new Date(payload.event.startedAt) : null,
				endsAt: payload.event.endedAt ? new Date(payload.event.endedAt) : null,
				signupOpen: false,
				published: true
			})
			.returning()
			.get();
	}

	// Slides: start from an empty set; step 2 uploads the current ones, withdrawn ones stay gone.
	await rm(deckDir(event.id), { recursive: true, force: true });
	await mkdir(deckDir(event.id), { recursive: true });

	const now = new Date();
	d.update(events)
		.set({ sourceEventId: payload.event.id, signupOpen: false })
		.where(eq(events.id, event.id))
		.run();
	d.insert(results)
		.values({
			eventId: event.id,
			sourceEventId: payload.event.id,
			payload: body,
			publishedAt: now
		})
		.onConflictDoUpdate({ target: results.eventId, set: { payload: body, publishedAt: now } })
		.run();
	return event.slug;
}

/** Stores one project's slides (step 2). Only for a project with hasDeck in the stored payload. */
export async function receiveDeck(
	sourceEventId: string,
	projectId: string,
	bytes: Uint8Array<ArrayBuffer>,
	signature: string | null
) {
	if (!siteEnv.publishSecret)
		throw new PublishError(503, 'Publishing is not set up on the site (SITE_PUBLISH_SECRET)');
	const input = deckSignatureInput(sourceEventId, projectId, await sha256Hex(bytes));
	if (!(await verifyPayload(siteEnv.publishSecret, input, signature)))
		throw new PublishError(401, 'Bad signature');
	const row = db().select().from(results).where(eq(results.sourceEventId, sourceEventId)).get();
	if (!row) throw new PublishError(404, 'Publish the results first');
	const payload = PublishPayload.safeParse(JSON.parse(row.payload));
	if (!payload.success || !payload.data.projects.some((p) => p.id === projectId && p.hasDeck)) {
		throw new PublishError(404, 'No such project with slides in the published results');
	}
	if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-')
		throw new PublishError(415, 'Not a PDF');
	const path = deckPath(row.eventId, projectId);
	if (!path) throw new PublishError(400, 'Bad project id');
	await mkdir(deckDir(row.eventId), { recursive: true });
	await Bun.write(path, bytes);
}
