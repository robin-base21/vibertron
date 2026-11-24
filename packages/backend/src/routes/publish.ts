import { PUBLISH_SIGNATURE_HEADER, deckSignatureInput, sha256Hex, signPayload, teamColor, type PublishPayload } from 'common';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { App, Routes } from '../app';
import { requireEventManager } from '../auth/guards';
import { events, projects } from '../db/schema';
import { eventDTO, participantCount, projectDTOs, teamDTOs, votingState } from '../dto';
import { HttpError, conflict, json } from '../http';
import { notifyEvent } from '../live/notify';

// The one integration with the public site: push the results (see common/src/publish.ts).

export function publishRoutes(app: App): Routes {
	const { db } = app;

	return {
		'/api/events/:id/publish': {
			POST: async (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const { sitePublishUrl, sitePublishSecret } = app.env;
				if (!sitePublishUrl || !sitePublishSecret) throw conflict('Publishing is not set up (SITE_PUBLISH_URL / SITE_PUBLISH_SECRET)');
				if (event.votingPhase !== 'results') throw conflict('Reveal the winner before publishing');

				const teams = teamDTOs(db, event.id);
				const all = projectDTOs(db, event.id);
				// Only what the authors agreed to show publicly.
				const shown = all.filter((p) => p.showcase === true);
				const shownIds = new Set(shown.map((p) => p.id));
				const pitch = votingState(db, event).results?.pitch ?? [];
				const teamOfProject = new Map(all.map((p) => [p.id, p.teamId]));

				const payload: PublishPayload = {
					version: 1,
					sentAt: Date.now(),
					event: {
						id: event.id,
						slug: event.slug,
						name: event.name,
						startedAt: event.startedAt?.getTime() ?? null,
						endedAt: event.endsAt?.getTime() ?? null,
						participantCount: participantCount(db, event.id),
						teamCount: teams.length
					},
					teams: teams.map((t) => {
						const c = teamColor(t.position);
						return { id: t.id, name: t.name, codename: t.codename, color: c.hex, striped: c.striped };
					}),
					projects: shown.map((p) => ({
						id: p.id,
						teamId: p.teamId,
						name: p.name,
						tagline: p.tagline,
						author: p.authorName,
						link: p.link,
						hasDeck: p.deckSize !== null
					})),
					ranking: pitch.map((r) => ({
						rank: r.rank,
						points: r.points,
						teamId: teamOfProject.get(r.projectId) ?? '',
						projectId: shownIds.has(r.projectId) ? r.projectId : null
					}))
				};

				const body = JSON.stringify(payload);
				const send = async (url: string, init: RequestInit, what: string) => {
					let res: Response;
					try {
						res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
					} catch (err) {
						throw new HttpError(502, 'publish_failed', `Could not reach the site: ${err instanceof Error ? err.message : err}`);
					}
					if (!res.ok) {
						const text = (await res.text().catch(() => '')).slice(0, 200);
						throw new HttpError(502, 'publish_failed', `The site answered ${res.status} to ${what}${text ? `: ${text}` : ''}`);
					}
				};

				// 1. Results (replaces what the site had, including its slides).
				await send(
					sitePublishUrl,
					{ method: 'POST', headers: { 'content-type': 'application/json', [PUBLISH_SIGNATURE_HEADER]: await signPayload(sitePublishSecret, body) }, body },
					'the results'
				);
				// 2. Slides, one signed PDF per project.
				for (const p of shown) {
					if (p.deckSize === null) continue;
					const ref = db.select({ ref: projects.deckRef }).from(projects).where(eq(projects.id, p.id)).get()?.ref;
					const file = ref ? Bun.file(join(app.env.uploadDir, ref)) : null;
					if (!file || !(await file.exists())) continue;
					const pdf = new Uint8Array(await file.arrayBuffer());
					const signature = await signPayload(sitePublishSecret, deckSignatureInput(event.id, p.id, await sha256Hex(pdf)));
					await send(
						`${sitePublishUrl.replace(/\/$/, '')}/decks/${encodeURIComponent(event.id)}/${encodeURIComponent(p.id)}`,
						{ method: 'PUT', headers: { 'content-type': 'application/pdf', [PUBLISH_SIGNATURE_HEADER]: signature }, body: pdf },
						`the slides of “${p.name}”`
					);
				}

				const updated = db.update(events).set({ publishedToSiteAt: new Date() }).where(eq(events.id, event.id)).returning().get()!;
				notifyEvent(app, updated);
				return json({ event: eventDTO(db, updated) });
			}
		}
	};
}
