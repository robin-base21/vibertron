import { fail } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { events, projectCuration, results } from '$lib/server/db/schema';
import { curationOf, manualProjectsOf, parseResults, withOverride } from '$lib/server/events';
import type { Actions, PageServerLoad } from './$types';

/**
 * Every showcase project per event, newest event first: published ones (as pushed, with site edits
 * shown) and ones added by hand. Lists events that have either, plus all events for "Add project".
 */
export const load: PageServerLoad = () => {
	const d = db();
	const payloads = new Map(
		d
			.select()
			.from(results)
			.all()
			.map((r) => [r.eventId, r])
	);
	const all = d.select().from(events).orderBy(desc(events.startsAt)).all();
	return {
		allEvents: all.map((e) => ({ id: e.id, name: e.name })),
		events: all
			.map((event) => {
				const pushed = payloads.get(event.id);
				const parsed = pushed ? parseResults(pushed.payload) : null;
				const { hidden, featuredAt, overrides } = curationOf(event.id);
				const rankOf = new Map(
					(parsed?.ranking ?? []).filter((r) => r.projectId).map((r) => [r.projectId!, r.rank])
				);
				const published = (parsed?.projects ?? [])
					.map((p) => ({
						...withOverride(p, overrides.get(p.id)),
						team: parsed?.teams.find((t) => t.id === p.teamId) ?? null,
						rank: rankOf.get(p.id) ?? null,
						hidden: hidden.has(p.id),
						featured: featuredAt.has(p.id),
						manual: false,
						edited: overrides.has(p.id)
					}))
					.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
				const manual = manualProjectsOf(event.id).map((m) => ({
					id: m.id,
					teamId: '',
					name: m.name,
					tagline: m.tagline,
					author: m.author,
					link: m.link,
					hasDeck: !!m.deckRef,
					team: m.teamName
						? { id: '', name: m.teamName, codename: null, color: '#121212', striped: false }
						: null,
					rank: null,
					hidden: hidden.has(m.id),
					featured: featuredAt.has(m.id),
					manual: true,
					edited: false
				}));
				return {
					id: event.id,
					name: event.name,
					slug: event.slug,
					published: event.published,
					publishedAt: pushed?.publishedAt ?? null,
					projects: [...published, ...manual]
				};
			})
			.filter((e) => e.publishedAt || e.projects.length)
	};
};

async function target(request: Request) {
	const form = await request.formData();
	const eventId = String(form.get('eventId') ?? '');
	const projectId = String(form.get('projectId') ?? '');
	if (!eventId || !projectId) return null;
	const current = db()
		.select()
		.from(projectCuration)
		.where(eq(projectCuration.eventId, eventId))
		.all()
		.find((r) => r.projectId === projectId);
	return { eventId, projectId, current };
}

function save(
	eventId: string,
	projectId: string,
	set: { hidden?: boolean; featuredAt?: Date | null }
) {
	db()
		.insert(projectCuration)
		.values({ eventId, projectId, ...set })
		.onConflictDoUpdate({ target: [projectCuration.eventId, projectCuration.projectId], set })
		.run();
}

export const actions: Actions = {
	/** Take a project off the site (or bring it back). Hiding also unfeatures it. */
	hide: async ({ request }) => {
		const t = await target(request);
		if (!t) return fail(400, { error: 'Missing project' });
		const hidden = !t.current?.hidden;
		save(t.eventId, t.projectId, hidden ? { hidden, featuredAt: null } : { hidden });
		return {};
	},
	/** Pin to the top of the showcase and the home page (or unpin). */
	feature: async ({ request }) => {
		const t = await target(request);
		if (!t) return fail(400, { error: 'Missing project' });
		save(
			t.eventId,
			t.projectId,
			t.current?.featuredAt ? { featuredAt: null } : { featuredAt: new Date(), hidden: false }
		);
		return {};
	}
};
