import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import { manualProjects, projectCuration } from './db/schema';
import { siteEnv } from './env';

/*
Showcase projects added or corrected by hand. Manual projects have their own table and slides folder,
so re-publishing from the event app (which replaces its own slides) never touches them. Corrections
of published projects are stored as overrides on project_curation.
*/

const SAFE_ID = /^[\w-]{1,64}$/;
export const DECK_MAX_BYTES = 20 * 1024 * 1024;

const manualDeckDir = (eventId: string) => resolve(siteEnv.dataDir, 'manual-decks', eventId);
export const manualDeckPath = (eventId: string, projectId: string) => {
	if (!SAFE_ID.test(eventId) || !SAFE_ID.test(projectId)) return null;
	const row = db()
		.select()
		.from(manualProjects)
		.where(and(eq(manualProjects.id, projectId), eq(manualProjects.eventId, eventId)))
		.get();
	return row?.deckRef ? join(manualDeckDir(eventId), row.deckRef) : null;
};

const link = z
	.string()
	.trim()
	.max(500)
	.refine((v) => !v || /^https?:\/\/\S+$/i.test(v), 'The link must start with http:// or https://');

export const ProjectFields = z.object({
	name: z.string().trim().min(1, 'Give the project a name').max(80),
	tagline: z.string().trim().max(200),
	author: z.string().trim().min(1, 'Who built it?').max(80),
	teamName: z.string().trim().max(60).default(''),
	link
});
export type ProjectFields = z.infer<typeof ProjectFields>;

const orNull = (v: string) => v || null;

async function saveDeck(
	eventId: string,
	id: string,
	file: File | null,
	oldRef: string | null
): Promise<string | null | undefined> {
	if (!file || file.size === 0) return undefined;
	if (file.size > DECK_MAX_BYTES) throw new Error('The PDF must be at most 20 MB');
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-')
		throw new Error('Slides must be a PDF');
	await mkdir(manualDeckDir(eventId), { recursive: true });
	const ref = `${id}-${Date.now()}.pdf`;
	await Bun.write(join(manualDeckDir(eventId), ref), bytes);
	if (oldRef) await rm(join(manualDeckDir(eventId), oldRef), { force: true });
	return ref;
}

export async function createManual(
	eventId: string,
	f: ProjectFields,
	deck: File | null
): Promise<string> {
	const id = crypto.randomUUID();
	const deckRef = (await saveDeck(eventId, id, deck, null)) ?? null;
	db()
		.insert(manualProjects)
		.values({
			id,
			eventId,
			name: f.name,
			tagline: orNull(f.tagline),
			author: f.author,
			teamName: orNull(f.teamName),
			link: orNull(f.link),
			deckRef
		})
		.run();
	return id;
}

export async function updateManual(
	eventId: string,
	id: string,
	f: ProjectFields,
	deck: File | null,
	removeDeck: boolean
) {
	const row = db()
		.select()
		.from(manualProjects)
		.where(and(eq(manualProjects.id, id), eq(manualProjects.eventId, eventId)))
		.get();
	if (!row) throw new Error('Project not found');
	let deckRef: string | null | undefined = await saveDeck(eventId, id, deck, row.deckRef);
	if (deckRef === undefined && removeDeck && row.deckRef) {
		await rm(join(manualDeckDir(eventId), row.deckRef), { force: true });
		deckRef = null;
	}
	db()
		.update(manualProjects)
		.set({
			name: f.name,
			tagline: orNull(f.tagline),
			author: f.author,
			teamName: orNull(f.teamName),
			link: orNull(f.link),
			...(deckRef === undefined ? {} : { deckRef })
		})
		.where(eq(manualProjects.id, id))
		.run();
}

export async function deleteManual(eventId: string, id: string) {
	const row = db()
		.select()
		.from(manualProjects)
		.where(and(eq(manualProjects.id, id), eq(manualProjects.eventId, eventId)))
		.get();
	if (!row) return;
	if (row.deckRef) await rm(join(manualDeckDir(eventId), row.deckRef), { force: true });
	db().delete(manualProjects).where(eq(manualProjects.id, id)).run();
	db()
		.delete(projectCuration)
		.where(and(eq(projectCuration.eventId, eventId), eq(projectCuration.projectId, id)))
		.run();
}

/**
 * Corrections of a published project. Only fields that differ from the published values are stored,
 * so a later re-publish with fixed data shows through for the rest. A link cleared on the site is "".
 */
export function saveOverride(
	eventId: string,
	projectId: string,
	f: Omit<ProjectFields, 'teamName'>,
	published: { name: string; tagline: string | null; author: string; link: string | null }
) {
	const diff = (v: string, orig: string | null) => (v === (orig ?? '') ? null : v);
	const set = {
		name: diff(f.name, published.name),
		tagline: diff(f.tagline, published.tagline),
		author: diff(f.author, published.author),
		link: diff(f.link, published.link)
	};
	db()
		.insert(projectCuration)
		.values({ eventId, projectId, ...set })
		.onConflictDoUpdate({ target: [projectCuration.eventId, projectCuration.projectId], set })
		.run();
}

export function resetOverride(eventId: string, projectId: string) {
	db()
		.update(projectCuration)
		.set({ name: null, tagline: null, author: null, link: null })
		.where(and(eq(projectCuration.eventId, eventId), eq(projectCuration.projectId, projectId)))
		.run();
}
