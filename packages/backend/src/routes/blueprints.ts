import { AnalyzeBody, Blueprint, SaveBlueprintBody, type BlueprintLibraryItemDTO } from 'common';
import { desc, eq } from 'drizzle-orm';
import { join } from 'node:path';
import { analyzeFloorplan } from '../ai/analyze';
import type { App, Routes } from '../app';
import { requireEventManager, requireRole } from '../auth/guards';
import { blueprints, events, uploads } from '../db/schema';
import { loadBlueprint } from '../dto';
import { HttpError, badRequest, conflict, json, notFound, parseBody } from '../http';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const REF_RE = /^[0-9a-f]{32}$/;

/** Detect the image type from magic bytes; the client-declared type is not trusted. */
export function sniffImageType(b: Uint8Array): string | null {
	const at = (i: number, ...bytes: number[]) => bytes.every((v, j) => b[i + j] === v);
	if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
	if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
	if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
	if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
	return null;
}

export function blueprintRoutes(app: App): Routes {
	const { db } = app;
	const uploadPath = (ref: string) => join(app.env.uploadDir, ref);

	/** An upload belonging to this event (or to no event); 400 for a malformed ref, 404 otherwise. */
	const eventUpload = (eventId: string, ref: string, field: string) => {
		if (!REF_RE.test(ref)) throw badRequest(`Invalid ${field}`);
		const row = db.select().from(uploads).where(eq(uploads.ref, ref)).get();
		if (!row || (row.eventId && row.eventId !== eventId)) throw notFound(`Image not found (${field})`);
		return row;
	};

	return {
		'/api/events/:id/blueprint': {
			GET: (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				return json(loadBlueprint(db, event.id));
			},
			PUT: async (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const body = await parseBody(req, SaveBlueprintBody);
				if (event.status === 'live') throw conflict('The blueprint is locked while the event is live');
				const version = db.transaction((tx) => {
					const current = tx.select({ version: blueprints.version }).from(blueprints).where(eq(blueprints.eventId, event.id)).get()?.version ?? 0;
					if (body.version !== current) throw conflict('Blueprint was changed by someone else', { version: current });
					const next = current + 1;
					const values = { json: JSON.stringify(body.blueprint), version: next, underlayPath: body.blueprint.underlay?.imageRef ?? null, updatedAt: new Date() };
					if (current === 0) tx.insert(blueprints).values({ id: crypto.randomUUID(), eventId: event.id, ...values }).run();
					else tx.update(blueprints).set(values).where(eq(blueprints.eventId, event.id)).run();
					return next;
				});
				app.live.toEvent(event.id, { type: 'blueprint.updated', eventId: event.id, blueprint: body.blueprint });
				return json({ version });
			}
		},
		'/api/blueprints/library': {
			GET: (req) => {
				const user = requireRole(app, req, 'manager');
				const exclude = new URL(req.url).searchParams.get('exclude');
				const rows = db
					.select({ event: events, json: blueprints.json, updatedAt: blueprints.updatedAt })
					.from(blueprints)
					.innerJoin(events, eq(events.id, blueprints.eventId))
					.where(user.role === 'admin' ? undefined : eq(events.managerId, user.id))
					.orderBy(desc(blueprints.updatedAt))
					.all();
				const items: BlueprintLibraryItemDTO[] = [];
				for (const r of rows) {
					if (r.event.id === exclude) continue;
					const parsed = Blueprint.safeParse(JSON.parse(r.json));
					// Skip unreadable and blank blueprints; there is nothing to reuse.
					if (!parsed.success || (parsed.data.segments.length === 0 && parsed.data.walls.length === 0 && parsed.data.outlines.length === 0)) continue;
					items.push({
						eventId: r.event.id,
						eventName: r.event.name,
						eventSlug: r.event.slug,
						status: r.event.status,
						startedAt: r.event.startedAt?.getTime() ?? null,
						updatedAt: r.updatedAt.getTime(),
						blueprint: parsed.data
					});
				}
				return json({ items });
			}
		},
		'/api/events/:id/uploads': {
			POST: async (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const length = Number(req.headers.get('content-length') ?? 0);
				if (length > MAX_UPLOAD_BYTES + 64 * 1024) throw new HttpError(413, 'too_large', 'Image must be at most 15 MB');
				const form = await req.formData().catch(() => null);
				if (!form) throw badRequest('Expected multipart/form-data');
				const file = form.get('file');
				if (!(file instanceof Blob)) throw badRequest('Missing "file" field');
				if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, 'too_large', 'Image must be at most 15 MB');
				const bytes = new Uint8Array(await file.arrayBuffer());
				const contentType = sniffImageType(bytes);
				if (!contentType) throw new HttpError(415, 'unsupported_media_type', 'Only PNG, JPEG, GIF and WebP images are allowed');
				const ref = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
				await Bun.write(uploadPath(ref), bytes);
				db.insert(uploads).values({ ref, eventId: event.id, contentType, size: bytes.length }).run();
				return json({ imageRef: ref }, { status: 201 });
			}
		},
		'/api/uploads/:ref': {
			GET: async (req) => {
				const ref = req.params.ref!;
				if (!REF_RE.test(ref)) throw notFound();
				const row = db.select().from(uploads).where(eq(uploads.ref, ref)).get();
				const file = Bun.file(uploadPath(ref));
				if (!row || !(await file.exists())) throw notFound();
				return new Response(file, {
					headers: {
						'Content-Type': row.contentType,
						'Cache-Control': 'public, max-age=31536000, immutable',
						'X-Content-Type-Options': 'nosniff'
					}
				});
			}
		},
		'/api/events/:id/blueprint/analyze': {
			POST: async (req) => {
				const { event } = requireEventManager(app, req, req.params.id!);
				const body = await parseBody(req, AnalyzeBody);
				const original = eventUpload(event.id, body.imageRef, 'imageRef');
				const marked = body.markedImageRef ? eventUpload(event.id, body.markedImageRef, 'markedImageRef') : null;
				// The model sees the numbered (marked) image when there is one; the original stays the underlay.
				const shown = marked ?? original;
				const bytes = new Uint8Array(await Bun.file(uploadPath(shown.ref)).arrayBuffer());
				const result = await analyzeFloorplan(
					{ apiKey: app.env.openrouterApiKey, model: app.env.openrouterModel, fetch: app.fetch },
					{ bytes, contentType: shown.contentType },
					{
						imageRef: original.ref,
						project: event.name,
						canvas: body.canvas,
						crop: body.crop,
						rooms: body.rooms,
						walls: body.walls,
						candidates: body.candidates,
						outlines: body.outlines
					}
				);
				return json(result);
			}
		}
	};
}
