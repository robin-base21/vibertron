import { PublishPayload } from 'common';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, asc, desc, eq, gte, isNull, lt, or } from 'drizzle-orm';
import { seatsLeft } from '$lib/seats';
import { previewsFor } from './previews';
import { db } from './db';
import { siteEnv } from './env';
import { events, manualProjects, projectCuration, results, signups } from './db/schema';

export type EventRow = typeof events.$inferSelect;

/** An event counts as past once it has results or its start lies behind us (day granularity). */
const startOfToday = () => {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
};

export function upcomingEvents(): EventRow[] {
	return db()
		.select()
		.from(events)
		.leftJoin(results, eq(results.eventId, events.id))
		.where(
			and(
				eq(events.published, true),
				isNull(results.eventId),
				or(isNull(events.startsAt), gte(events.startsAt, startOfToday()))
			)
		)
		.orderBy(asc(events.startsAt))
		.all()
		.map((r) => r.events);
}

export interface PastEvent {
	event: EventRow;
	results: PublishPayload | null;
}

export function pastEvents(limit = 50): PastEvent[] {
	return db()
		.select()
		.from(events)
		.leftJoin(results, eq(results.eventId, events.id))
		.where(
			and(
				eq(events.published, true),
				or(lt(events.startsAt, startOfToday()), eq(results.eventId, events.id))
			)
		)
		.orderBy(desc(events.startsAt))
		.limit(limit)
		.all()
		.map((r) => ({
			event: r.events,
			results: r.results ? curatedResults(r.events.id, r.results.payload) : null
		}));
}

/** Admin curation of an event's projects: hidden ones, and when each was featured. */
export function curationOf(eventId: string): {
	hidden: Set<string>;
	featuredAt: Map<string, Date>;
	overrides: Map<string, ProjectOverride>;
} {
	const rows = db()
		.select()
		.from(projectCuration)
		.where(eq(projectCuration.eventId, eventId))
		.all();
	return {
		hidden: new Set(rows.filter((r) => r.hidden).map((r) => r.projectId)),
		featuredAt: new Map(rows.filter((r) => r.featuredAt).map((r) => [r.projectId, r.featuredAt!])),
		overrides: new Map(
			rows
				.filter(
					(r) => r.name !== null || r.tagline !== null || r.author !== null || r.link !== null
				)
				.map((r) => [
					r.projectId,
					{ name: r.name, tagline: r.tagline, author: r.author, link: r.link }
				])
		)
	};
}

/** Pushed results as the public sees them: hidden projects are gone (like private ones). */
export function curatedResults(eventId: string, json: string): PublishPayload | null {
	const parsed = parseResults(json);
	if (!parsed) return null;
	const { hidden, overrides } = curationOf(eventId);
	if (!hidden.size && !overrides.size) return parsed;
	return {
		...parsed,
		projects: parsed.projects
			.filter((p) => !hidden.has(p.id))
			.map((p) => withOverride(p, overrides.get(p.id))),
		ranking: parsed.ranking.map((r) =>
			r.projectId && hidden.has(r.projectId) ? { ...r, projectId: null } : r
		)
	};
}

/** Site-only text corrections of a published project (a field left null keeps the published value). */
export interface ProjectOverride {
	name: string | null;
	tagline: string | null;
	author: string | null;
	/** "" removes the published link. */
	link: string | null;
}

export function withOverride<P extends PublishPayload['projects'][number]>(
	p: P,
	o: ProjectOverride | undefined
): P {
	if (!o) return p;
	return {
		...p,
		name: o.name ?? p.name,
		tagline: o.tagline ?? p.tagline,
		author: o.author ?? p.author,
		link: o.link === null ? p.link : o.link || null
	};
}

export type ManualProjectRow = typeof manualProjects.$inferSelect;

export function manualProjectsOf(eventId: string): ManualProjectRow[] {
	return db()
		.select()
		.from(manualProjects)
		.where(eq(manualProjects.eventId, eventId))
		.orderBy(asc(manualProjects.createdAt))
		.all();
}

export function parseResults(json: string): PublishPayload | null {
	const parsed = PublishPayload.safeParse(JSON.parse(json));
	return parsed.success ? parsed.data : null;
}

export function eventBySlug(
	slug: string
): { event: EventRow; results: PublishPayload | null } | null {
	const row = db()
		.select()
		.from(events)
		.leftJoin(results, eq(results.eventId, events.id))
		.where(eq(events.slug, slug))
		.get();
	return row
		? {
				event: row.events,
				results: row.results ? curatedResults(row.events.id, row.results.payload) : null
			}
		: null;
}

/** Seats left right now (held, finished or paid signups take one); null: no limit. */
export function spotsLeft(event: EventRow): number | null {
	const rows = db().select().from(signups).where(eq(signups.eventId, event.id)).all();
	return seatsLeft(event.capacity, rows, new Date());
}

export const slugify = (s: string) =>
	s
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/[\s_]+/g, '-')
		.replace(/-+/g, '-')
		.slice(0, 50) || 'event';

/** A slug not taken yet (appends -2, -3, ...). */
export function freeSlug(base: string, exceptId?: string): string {
	for (let i = 1; ; i++) {
		const slug = i === 1 ? base : `${base}-${i}`;
		const taken = db().select({ id: events.id }).from(events).where(eq(events.slug, slug)).get();
		if (!taken || taken.id === exceptId) return slug;
	}
}

export interface ShowcaseItem {
	eventSlug: string;
	eventName: string;
	siteEventId: string;
	project: PublishPayload['projects'][number];
	team: PublishPayload['teams'][number] | null;
	/** Place in the final pitch round, if it pitched. */
	rank: number | null;
	/** Pinned by an admin. */
	featured: boolean;
	/** Added by hand on the site rather than published from the event app. */
	manual: boolean;
	/** Preview image of the project link (/previews/...), once fetched. */
	image: string | null;
}

/**
 * Projects from published results (hidden ones already removed): featured first (most recently
 * featured on top), then newest event first, winners first within an event.
 */
export function showcaseItems(past: PastEvent[] = pastEvents()): ShowcaseItem[] {
	const featuredAt = new Map<string, number>();
	const items = past.flatMap(({ event, results }) => {
		const curation = curationOf(event.id);
		for (const [id, at] of curation.featuredAt) featuredAt.set(`${event.id}/${id}`, at.getTime());
		const base = {
			eventSlug: event.slug,
			eventName: event.name,
			siteEventId: event.id,
			featured: false
		};
		const rankOf = new Map(
			(results?.ranking ?? []).filter((r) => r.projectId).map((r) => [r.projectId!, r.rank])
		);
		const published = (results?.projects ?? [])
			.map((project) => ({
				...base,
				project,
				team: results!.teams.find((t) => t.id === project.teamId) ?? null,
				rank: rankOf.get(project.id) ?? null,
				manual: false,
				image: null as string | null
			}))
			.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
		// Added by hand on the site: after the published ones, never ranked.
		const manual = manualProjectsOf(event.id)
			.filter((m) => !curation.hidden.has(m.id))
			.map((m) => ({
				...base,
				project: {
					id: m.id,
					teamId: '',
					name: m.name,
					tagline: m.tagline,
					author: m.author,
					link: m.link,
					hasDeck: !!m.deckRef
				},
				team: m.teamName
					? { id: '', name: m.teamName, codename: null, color: MANUAL_TEAM_COLOR, striped: false }
					: null,
				rank: null,
				manual: true,
				image: null as string | null
			}));
		return [...published, ...manual];
	});
	const images = previewsFor(items.map((i) => i.project.link ?? ''));
	for (const item of items) {
		item.featured = featuredAt.has(`${item.siteEventId}/${item.project.id}`);
		item.image = item.project.link ? (images.get(item.project.link) ?? null) : null;
	}
	// Stable sort: featured float to the top, the rest keep their order.
	const at = (i: ShowcaseItem) => featuredAt.get(`${i.siteEventId}/${i.project.id}`) ?? 0;
	return items.sort((a, b) => Number(b.featured) - Number(a.featured) || at(b) - at(a));
}

/** Team dot colour for manually added projects (no team colour from the event app). */
const MANUAL_TEAM_COLOR = '#121212';

/** The event the home page promotes: the featured one if it is upcoming, else the next one. */
export function heroEvent(): EventRow | null {
	const upcoming = upcomingEvents();
	return upcoming.find((e) => e.featured) ?? upcoming[0] ?? null;
}

/** The winning entry of a published event (null when the winner kept their project private). */
export function winnerOf(results: PublishPayload | null): {
	project: PublishPayload['projects'][number] | null;
	team: PublishPayload['teams'][number] | null;
} | null {
	const top = results?.ranking.find((r) => r.rank === 1);
	if (!results || !top) return null;
	return {
		project: results.projects.find((p) => p.id === top.projectId) ?? null,
		team: results.teams.find((t) => t.id === top.teamId) ?? null
	};
}

/** Deletes an event with everything stored for it: rows (cascade) and its files on disk. */
export async function deleteEvent(id: string) {
	db().delete(events).where(eq(events.id, id)).run();
	for (const dir of ['flyers', 'proofs', 'decks', 'manual-decks'])
		await rm(resolve(siteEnv.dataDir, dir, id), { recursive: true, force: true });
}
