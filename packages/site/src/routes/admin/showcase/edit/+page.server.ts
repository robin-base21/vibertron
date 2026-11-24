import { error, fail, redirect } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { events, manualProjects, results } from '$lib/server/db/schema';
import { curationOf, parseResults } from '$lib/server/events';
import {
	ProjectFields,
	createManual,
	deleteManual,
	resetOverride,
	saveOverride,
	updateManual
} from '$lib/server/manualProjects';
import type { Actions, PageServerLoad } from './$types';

/** The project being edited: added by hand, or published from the event app (with its site edits). */
function find(eventId: string, projectId: string) {
	const manual = db().select().from(manualProjects).where(eq(manualProjects.id, projectId)).get();
	if (manual && manual.eventId === eventId) return { kind: 'manual' as const, manual };
	const pushed = db().select().from(results).where(eq(results.eventId, eventId)).get();
	const published = pushed
		? parseResults(pushed.payload)?.projects.find((p) => p.id === projectId)
		: undefined;
	if (published)
		return {
			kind: 'published' as const,
			published,
			override: curationOf(eventId).overrides.get(projectId) ?? null
		};
	return null;
}

export const load: PageServerLoad = ({ url }) => {
	const eventId = url.searchParams.get('event') ?? '';
	const projectId = url.searchParams.get('project');
	const allEvents = db()
		.select({ id: events.id, name: events.name })
		.from(events)
		.orderBy(desc(events.startsAt))
		.all();
	if (!projectId)
		return {
			mode: 'new' as const,
			allEvents,
			eventId,
			project: null,
			published: null,
			hasDeck: false,
			edited: false
		};
	const found = find(eventId, projectId);
	if (!found) error(404, 'Project not found');
	const eventName = allEvents.find((e) => e.id === eventId)?.name ?? '';
	if (found.kind === 'manual') {
		const m = found.manual;
		return {
			mode: 'manual' as const,
			allEvents,
			eventId,
			eventName,
			project: {
				name: m.name,
				tagline: m.tagline ?? '',
				author: m.author,
				teamName: m.teamName ?? '',
				link: m.link ?? ''
			},
			published: null,
			hasDeck: !!m.deckRef,
			edited: false
		};
	}
	const p = found.published;
	const o = found.override;
	return {
		mode: 'published' as const,
		allEvents,
		eventId,
		eventName,
		project: {
			name: o?.name ?? p.name,
			tagline: o?.tagline ?? p.tagline ?? '',
			author: o?.author ?? p.author,
			teamName: '',
			link: o?.link ?? p.link ?? ''
		},
		published: { name: p.name, tagline: p.tagline ?? '', author: p.author, link: p.link ?? '' },
		hasDeck: p.hasDeck,
		edited: !!o
	};
};

export const actions: Actions = {
	save: async ({ request, url }) => {
		const data = await request.formData();
		const values = Object.fromEntries(
			[...data.entries()].filter(([, v]) => typeof v === 'string')
		) as Record<string, string>;
		const parsed = ProjectFields.safeParse(values);
		if (!parsed.success)
			return fail(400, { values, error: parsed.error.issues[0]?.message ?? 'Check the form' });
		const projectId = url.searchParams.get('project');
		const deck = data.get('deck');
		const file = deck instanceof File ? deck : null;
		try {
			if (!projectId) {
				const eventId = values.eventId ?? '';
				if (!db().select().from(events).where(eq(events.id, eventId)).get())
					return fail(400, { values, error: 'Pick an event' });
				await createManual(eventId, parsed.data, file);
			} else {
				const eventId = url.searchParams.get('event') ?? '';
				const found = find(eventId, projectId);
				if (!found) error(404, 'Project not found');
				if (found.kind === 'manual')
					await updateManual(
						eventId,
						projectId,
						parsed.data,
						file,
						data.get('removeDeck') === 'on'
					);
				else saveOverride(eventId, projectId, parsed.data, found.published);
			}
		} catch (err) {
			return fail(400, { values, error: err instanceof Error ? err.message : 'Could not save' });
		}
		redirect(303, '/admin/showcase');
	},
	/** Back to the text the event app published. */
	reset: async ({ url }) => {
		resetOverride(url.searchParams.get('event') ?? '', url.searchParams.get('project') ?? '');
		redirect(303, '/admin/showcase');
	},
	delete: async ({ url }) => {
		await deleteManual(url.searchParams.get('event') ?? '', url.searchParams.get('project') ?? '');
		redirect(303, '/admin/showcase');
	}
};
