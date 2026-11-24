import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { formatDate, formatTime } from '$lib/format';
import { aiImage } from './ai';
import { db } from './db';
import { events, flyers } from './db/schema';
import { siteEnv } from './env';
import type { EventRow } from './events';
import { sniffImage } from './signups';

// AI flyers: the event's own details + a style reference image + an optional prompt go to the image
// model; every result is kept, and the admin picks the one the event page shows.

export const FLYER_ASPECTS = ['4:5', '1:1', '9:16', '3:4', '16:9'] as const;
export type FlyerAspect = (typeof FLYER_ASPECTS)[number];
export const REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const FLYER_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export type FlyerRow = typeof flyers.$inferSelect;

export const flyerDir = (eventId: string) => resolve(siteEnv.dataDir, 'flyers', eventId);
export const flyerFile = (eventId: string, ref: string) => join(flyerDir(eventId), ref);

export const flyersOf = (eventId: string): FlyerRow[] =>
	db()
		.select()
		.from(flyers)
		.where(eq(flyers.eventId, eventId))
		.orderBy(desc(flyers.createdAt))
		.all();

export const flyerById = (id: string) => db().select().from(flyers).where(eq(flyers.id, id)).get();

/** The facts a flyer may show, spelled exactly. */
function detailLines(event: EventRow, host: string): string[] {
	return [
		`Title: ${event.name}`,
		event.tagline && `Tagline: ${event.tagline}`,
		event.startsAt && `Date: ${formatDate(event.startsAt)}`,
		event.startsAt &&
			`Time: ${formatTime(event.startsAt)}${event.endsAt ? ` – ${formatTime(event.endsAt)}` : ''}`,
		event.venue && `Place: ${event.venue}`,
		event.priceNote && `Price: ${event.priceNote}`,
		`Sign up: ${host}`
	]
		.filter((l): l is string => !!l)
		.map((l) => `- ${l}`);
}

/** fresh/style/update: made by AI; own: uploaded as is. */
export type FlyerMode = 'fresh' | 'style' | 'update' | 'own';

function flyerPrompt(event: EventRow, host: string, extra: string, mode: FlyerMode): string {
	const details = detailLines(event, host);
	if (mode === 'update')
		return [
			'Edit the attached event flyer. Keep its design exactly as it is: the same layout and composition, the same illustration or photo, the same typography, text sizes and positions, the same style. Change only what is listed below.',
			'',
			'1. Replace the event details on it with these, spelled exactly as written. Put each one where the matching old detail was; remove old details that have no replacement here, and do not add other text:',
			...details,
			'',
			extra ? `2. Also make these changes, and nothing else: ${extra}` : '2. Make no other changes.'
		].join('\n');
	return [
		'Design a striking event flyer (poster) for a community tech event in Busan, Korea: a "vibe coding" afternoon where people build something with AI tools, in teams, then pitch it.',
		'',
		'Put exactly this text on it, spelled exactly as written, clearly readable, and no other words, logos, QR codes or made-up details:',
		...details,
		'',
		mode === 'style'
			? 'The attached image is a style reference only. Closely match its visual style: colour palette, typography, graphic elements, texture, composition and mood, so the flyer clearly looks like it belongs to the same series. Do not copy any of its text, numbers, logos or people.'
			: 'Style: bold, playful, high contrast; black and white with an orange (#ff4929) accent.',
		extra ? `\nThe organiser adds: ${extra}` : ''
	].join('\n');
}

/** Earlier flyers of all events, newest first: starting points for a new one. */
export function flyerSources(limit = 12) {
	return db()
		.select({
			id: flyers.id,
			aspect: flyers.aspect,
			createdAt: flyers.createdAt,
			eventId: flyers.eventId,
			eventName: events.name
		})
		.from(flyers)
		.innerJoin(events, eq(events.id, flyers.eventId))
		.orderBy(desc(flyers.createdAt))
		.limit(limit)
		.all();
}

async function storeImage(eventId: string, name: string, bytes: Uint8Array, allowGif = false) {
	const kind = sniffImage(bytes);
	if (!kind || kind.ext === 'heic' || (kind.ext === 'gif' && !allowGif))
		throw new Error('Unsupported image type');
	await mkdir(flyerDir(eventId), { recursive: true });
	const ref = `${name}.${kind.ext}`;
	await Bun.write(flyerFile(eventId, ref), bytes);
	return { ref, type: kind.type };
}

export type FlyerSource =
	{ kind: 'flyer'; id: string } | { kind: 'upload'; bytes: Uint8Array } | null;

async function sourceImage(source: FlyerSource) {
	if (!source) return null;
	if (source.kind === 'upload') {
		const kind = sniffImage(source.bytes);
		if (!kind || kind.ext === 'heic' || kind.ext === 'gif')
			throw new Error('Use a PNG, JPEG or WebP image');
		return { bytes: source.bytes, type: kind.type };
	}
	const row = flyerById(source.id);
	const file = row && Bun.file(flyerFile(row.eventId, row.imageRef));
	if (!file || !(await file.exists())) throw new Error('That flyer is gone; pick another one');
	const bytes = new Uint8Array(await file.arrayBuffer());
	return { bytes, type: sniffImage(bytes)?.type ?? 'image/png' };
}

/**
 * Generates and stores a flyer: fresh, in the style of an image, or an earlier flyer / uploaded
 * flyer updated with this event's details.
 */
export async function generateFlyer(
	event: EventRow,
	o: { host: string; source: FlyerSource; mode: FlyerMode; prompt: string; aspect: FlyerAspect }
): Promise<FlyerRow> {
	const id = crypto.randomUUID();
	const mode: FlyerMode = o.source ? (o.mode === 'fresh' ? 'style' : o.mode) : 'fresh';
	const image = await aiImage({
		prompt: flyerPrompt(event, o.host, o.prompt, mode),
		reference: await sourceImage(o.source),
		aspect: o.aspect
	});
	const stored = await storeImage(event.id, id, image.bytes);
	// An upload is kept next to the flyer (only once a flyer came back).
	const referenceRef =
		o.source?.kind === 'upload'
			? (await storeImage(event.id, `ref-${id}`, o.source.bytes)).ref
			: null;
	return db()
		.insert(flyers)
		.values({
			id,
			eventId: event.id,
			imageRef: stored.ref,
			referenceRef,
			sourceFlyerId: o.source?.kind === 'flyer' ? o.source.id : null,
			mode,
			prompt: o.prompt || null,
			aspect: o.aspect,
			model: image.model
		})
		.returning()
		.get();
}

/** A finished flyer made elsewhere (Canva, Figma, a designer), stored as is. */
export async function addOwnFlyer(event: EventRow, bytes: Uint8Array): Promise<FlyerRow> {
	const kind = sniffImage(bytes);
	if (!kind || kind.ext === 'heic') throw new Error('Upload a PNG, JPEG, WebP or GIF image');
	const id = crypto.randomUUID();
	const stored = await storeImage(event.id, id, bytes, true);
	return db()
		.insert(flyers)
		.values({
			id,
			eventId: event.id,
			imageRef: stored.ref,
			mode: 'own',
			aspect: 'own',
			model: 'upload'
		})
		.returning()
		.get();
}

export function useFlyer(event: EventRow, flyerId: string | null) {
	if (flyerId && !flyersOf(event.id).some((f) => f.id === flyerId)) return;
	db().update(events).set({ flyerId }).where(eq(events.id, event.id)).run();
}

export async function deleteFlyer(event: EventRow, flyerId: string) {
	const row = db()
		.select()
		.from(flyers)
		.where(and(eq(flyers.id, flyerId), eq(flyers.eventId, event.id)))
		.get();
	if (!row) return;
	db().delete(flyers).where(eq(flyers.id, row.id)).run();
	if (event.flyerId === row.id)
		db().update(events).set({ flyerId: null }).where(eq(events.id, event.id)).run();
	await rm(flyerFile(event.id, row.imageRef), { force: true });
	// The reference file may be shared with later flyers; remove it once none uses it.
	if (row.referenceRef && !flyersOf(event.id).some((f) => f.referenceRef === row.referenceRef))
		await rm(flyerFile(event.id, row.referenceRef), { force: true });
}
