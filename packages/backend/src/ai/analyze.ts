import { Blueprint, type AnalyzeResultDTO, type AnalyzeRoom, type Outline, type Point } from 'common';
import { z } from 'zod';
import { AnalyzeReplyV1, analyzeJsonSchemaV1, blueprintFromAreas, buildPromptV1, fallbackBlueprintV1 } from './analyze-v1';
import {
	baseBlueprint,
	canvasOf,
	clamp,
	makeSegment,
	nameDeduper,
	rectOf,
	roomGeometry,
	roomPolygon,
	round,
	toModelSpace,
	type BuildInput,
	type Canvas,
	type Rect
} from './draft';
import { AiError, imageDataUrl, structuredCompletion, type ChatMessage, type OpenRouterConfig } from './openrouter';

// Floorplan labelling v2: the marked (Set-of-Marks) building image + a short room list ->
// room names/kinds and work zones. The model never counts stations; the manager does.

export type { BuildInput } from './draft';

/** rooms[i] is drawn as number i + ROOM_MARK_BASE on the marked image. */
export const ROOM_MARK_BASE = 1;
/** Zone edges snap to a wall within this fraction of the canvas' long side. */
export const SNAP_TOLERANCE = 0.02;
/** Zones smaller than this fraction of the long side (after clamping) are dropped. */
export const MIN_ZONE = 0.01;
/** Confidence given to extra zones (work areas the CV missed); low, so they show as uncertain. */
export const EXTRA_ZONE_CONFIDENCE = 0.5;

export const ROOM_KINDS = ['work', 'lounge', 'kitchen', 'meeting', 'corridor', 'stairs', 'toilet', 'storage', 'other'] as const;
export const RoomKind = z.enum(ROOM_KINDS);
export type RoomKind = z.infer<typeof RoomKind>;

const Name = z
	.string()
	.trim()
	.min(1)
	.transform((s) => s.slice(0, 60));

/** [ymin, xmin, ymax, xmax] in 0..1000 of the marked image. */
const Box = z.array(z.number()).length(4);

export const Zone = z.object({ name: Name, kind: RoomKind, box: Box });
export type Zone = z.infer<typeof Zone>;

export const RoomReply = z.object({
	index: z.number().int(),
	name: Name,
	kind: RoomKind,
	confidence: z.number().transform((c) => clamp(c, 0, 1)),
	zones: z.array(Zone).max(40).default([])
});
export type RoomReply = z.infer<typeof RoomReply>;

export const AnalyzeReplyV2 = z.object({
	rooms: z.array(RoomReply).max(200),
	extraZones: z.array(Zone).max(40).default([])
});
export type AnalyzeReplyV2 = z.infer<typeof AnalyzeReplyV2>;

const boxSchema = {
	type: 'array',
	items: { type: 'number' },
	description: '[ymin, xmin, ymax, xmax], integers 0..1000 relative to the image height/width'
} as const;

const zoneSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['name', 'kind', 'box'],
	properties: {
		name: { type: 'string', description: 'Short label, e.g. "Hall A tables"' },
		kind: { type: 'string', enum: ROOM_KINDS },
		box: boxSchema
	}
} as const;

// Plain JSON Schema (no provider-specific extensions) so any structured-output model can use it.
export const analyzeJsonSchemaV2 = {
	type: 'object',
	additionalProperties: false,
	required: ['rooms', 'extraZones'],
	properties: {
		rooms: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['index', 'name', 'kind', 'confidence', 'zones'],
				properties: {
					index: { type: 'integer', description: 'The number drawn on the room in the image' },
					name: { type: 'string', description: 'Label written on the plan, else a short descriptive name' },
					kind: { type: 'string', enum: ROOM_KINDS },
					confidence: { type: 'number', description: '0..1' },
					zones: { type: 'array', items: zoneSchema, description: 'Distinct furniture clusters inside an open space; [] otherwise' }
				}
			}
		},
		extraZones: { type: 'array', items: zoneSchema, description: 'Work areas with no numbered room; usually []' }
	}
} as const;

const SYSTEM_PROMPT_V2 = `You label venue floorplans for a hackathon seating tool.
The image shows one building. Every room found by computer vision is outlined and marked with a large number.
For EACH numbered room return:
- index: the number drawn on it.
- name: the label written on the plan if there is one, else a short descriptive name ("Main Hall", "Kitchen", "WC").
- kind: one of work (open office, hall, classroom, lab: tables where teams can sit with laptops), lounge, kitchen, meeting (small closed meeting room), corridor, stairs, toilet, storage, other.
- confidence: how sure you are about name and kind, 0..1.
- zones: only for large open spaces that contain several distinct furniture clusters (e.g. separate groups of desks, a lounge corner). One entry per cluster with name, kind and box. Use [] for ordinary rooms.
extraZones: work areas with tables that have no number at all (missed by computer vision); usually [].
Boxes are [ymin, xmin, ymax, xmax] as integers from 0 to 1000 relative to the image height and width (0,0 = top left).
Do not count seats or stations.
Return JSON only.`;

/** Canvas rect -> [ymin, xmin, ymax, xmax] in the model's 0..1000 space. */
function modelBox(points: Point[], canvas: Canvas): number[] {
	const r = rectOf(toModelSpace(points, canvas));
	return [r.y0, r.x0, r.y1, r.x1].map(Math.round);
}

export function buildPromptV2(imageUrl: string, rooms: AnalyzeRoom[], canvas: Canvas): ChatMessage[] {
	const list = rooms.length
		? rooms.map((r, i) => `${i + ROOM_MARK_BASE}: box ${JSON.stringify(modelBox(r.points, canvas))}`).join('\n')
		: '(no rooms were detected: describe the work areas as extraZones)';
	return [
		{ role: 'system', content: SYSTEM_PROMPT_V2 },
		{
			role: 'user',
			content: [
				{ type: 'text', text: `Numbered rooms (${rooms.length}), boxes as [ymin, xmin, ymax, xmax]:\n${list}` },
				{ type: 'image_url', image_url: { url: imageUrl } }
			]
		}
	];
}

/** [ymin, xmin, ymax, xmax] in 0..1000 model space -> canvas rect (edges ordered). */
export function boxToRect(box: number[], canvas: Canvas): Rect {
	const [ya, xa, yb, xb] = box.map((v) => clamp(v, 0, 1000)) as [number, number, number, number];
	return {
		x0: (Math.min(xa, xb) * canvas.w) / 1000,
		y0: (Math.min(ya, yb) * canvas.h) / 1000,
		x1: (Math.max(xa, xb) * canvas.w) / 1000,
		y1: (Math.max(ya, yb) * canvas.h) / 1000
	};
}

interface AxisWall {
	/** The constant coordinate (x for vertical walls, y for horizontal ones). */
	at: number;
	from: number;
	to: number;
}

/** Split axis-aligned walls into vertical (x = const) and horizontal (y = const) lines. */
export function wallAxes(walls: [Point, Point][], canvas: Canvas) {
	const eps = 0.01 * Math.max(canvas.w, canvas.h);
	const vertical: AxisWall[] = [];
	const horizontal: AxisWall[] = [];
	for (const [a, b] of walls) {
		const dx = Math.abs(a[0] - b[0]);
		const dy = Math.abs(a[1] - b[1]);
		if (dx <= eps && dy > dx) vertical.push({ at: (a[0] + b[0]) / 2, from: Math.min(a[1], b[1]), to: Math.max(a[1], b[1]) });
		else if (dy <= eps && dx > dy) horizontal.push({ at: (a[1] + b[1]) / 2, from: Math.min(a[0], b[0]), to: Math.max(a[0], b[0]) });
	}
	return { vertical, horizontal };
}

/** Nearest wall line within `tol` whose span overlaps [lo, hi]; otherwise the value itself. */
function snap(value: number, lines: AxisWall[], lo: number, hi: number, tol: number): number {
	let best = value;
	let bestDist = tol;
	for (const l of lines) {
		if (l.to < lo - tol || l.from > hi + tol) continue;
		const d = Math.abs(l.at - value);
		if (d <= bestDist) {
			best = l.at;
			bestDist = d;
		}
	}
	return best;
}

/** Snap each edge of a rect to nearby walls, then clamp it into `bounds`. Null when it collapses. */
export function fitZone(rect: Rect, walls: ReturnType<typeof wallAxes>, bounds: Rect, canvas: Canvas): Rect | null {
	const long = Math.max(canvas.w, canvas.h);
	const tol = SNAP_TOLERANCE * long;
	const snapped: Rect = {
		x0: snap(rect.x0, walls.vertical, rect.y0, rect.y1, tol),
		x1: snap(rect.x1, walls.vertical, rect.y0, rect.y1, tol),
		y0: snap(rect.y0, walls.horizontal, rect.x0, rect.x1, tol),
		y1: snap(rect.y1, walls.horizontal, rect.x0, rect.x1, tol)
	};
	const r: Rect = {
		x0: clamp(snapped.x0, bounds.x0, bounds.x1),
		x1: clamp(snapped.x1, bounds.x0, bounds.x1),
		y0: clamp(snapped.y0, bounds.y0, bounds.y1),
		y1: clamp(snapped.y1, bounds.y0, bounds.y1)
	};
	const min = MIN_ZONE * long;
	return r.x1 - r.x0 >= min && r.y1 - r.y0 >= min ? r : null;
}

const rectPoints = (r: Rect): Point[] => [round([r.x0, r.y0]), round([r.x1, r.y1])];
const rectPolygon = (r: Rect): Point[] => [
	round([r.x0, r.y0]),
	round([r.x1, r.y0]),
	round([r.x1, r.y1]),
	round([r.x0, r.y1])
];

/**
 * Build the v2 draft: work rooms (or their work zones) become unconfirmed segments with 0 stations,
 * non-work rooms and zones become labelled outlines, walls are kept as editable walls.
 */
export function blueprintFromRooms(reply: AnalyzeReplyV2, input: BuildInput): Blueprint {
	const bp = baseBlueprint(input);
	const canvas = canvasOf(input);
	const rooms = input.rooms ?? [];
	const walls = wallAxes(input.walls ?? [], canvas);
	const whole: Rect = { x0: 0, y0: 0, x1: canvas.w, y1: canvas.h };
	const uniqueName = nameDeduper();

	const addSegment = (name: string, shape: 'rect' | 'polygon', points: Point[], confidence: number) =>
		bp.segments.push(makeSegment(`s${bp.segments.length + 1}`, uniqueName(name), shape, points, 0, confidence));
	const addOutline = (points: Point[], label?: string) => {
		const o: Outline = { id: `o${bp.outlines.length + 1}`, kind: 'room', points, closed: true };
		if (label) o.label = label;
		bp.outlines.push(o);
	};
	/** Non-work zones become labelled outlines, work zones segments. Returns how many work zones landed. */
	const placeZones = (zones: Zone[], bounds: Rect, confidence: number) => {
		let work = 0;
		for (const z of zones) {
			const r = fitZone(boxToRect(z.box, canvas), walls, bounds, canvas);
			if (!r) continue;
			if (z.kind === 'work') {
				addSegment(z.name, 'rect', rectPoints(r), confidence);
				work++;
			} else addOutline(rectPolygon(r), z.name);
		}
		return work;
	};

	const byIndex = new Map<number, RoomReply>();
	for (const r of reply.rooms) {
		const i = r.index - ROOM_MARK_BASE;
		if (i >= 0 && i < rooms.length && !byIndex.has(i)) byIndex.set(i, r);
	}

	rooms.forEach((room, i) => {
		const info = byIndex.get(i);
		// The model skipped this room: keep its shape as an unlabelled outline for the manager.
		if (!info) return addOutline(roomPolygon(room));
		const workZones = placeZones(info.zones, rectOf(room.points), info.confidence);
		if (info.kind === 'work') {
			if (workZones === 0) {
				const g = roomGeometry(room);
				addSegment(info.name, g.shape, g.points, info.confidence);
			}
		} else addOutline(roomPolygon(room), info.name);
	});
	placeZones(reply.extraZones, whole, EXTRA_ZONE_CONFIDENCE);

	return Blueprint.parse(bp);
}

/** No AI (v2): every room becomes an unnamed segment; walls are kept. */
export function fallbackBlueprintV2(input: BuildInput): Blueprint {
	const bp = baseBlueprint(input);
	bp.segments = (input.rooms ?? []).map((room, i) => {
		const g = roomGeometry(room);
		return makeSegment(`s${i + 1}`, `Area ${i + 1}`, g.shape, g.points);
	});
	return Blueprint.parse(bp);
}

/** Legacy requests carry v1 `candidates` and no v2 `rooms`. */
export const isLegacy = (input: BuildInput) => (input.rooms ?? []).length === 0 && (input.candidates ?? []).length > 0;

export function fallbackBlueprint(input: BuildInput): Blueprint {
	return isLegacy(input) ? fallbackBlueprintV1(input) : fallbackBlueprintV2(input);
}

/**
 * `image` is what the model sees: the marked image for v2 requests when the client sent one,
 * otherwise the original upload.
 */
export async function analyzeFloorplan(
	cfg: OpenRouterConfig,
	image: { bytes: Uint8Array; contentType: string },
	input: BuildInput
): Promise<AnalyzeResultDTO> {
	const what = isLegacy(input) ? 'candidate polygons' : 'detected rooms';
	if (!cfg.apiKey) {
		return { blueprint: fallbackBlueprint(input), source: 'fallback', warning: `AI is not configured; ${what} were added as unnamed areas.` };
	}
	const imageUrl = imageDataUrl(image.bytes, image.contentType);
	const canvas = canvasOf(input);
	try {
		if (isLegacy(input)) {
			const reply = await structuredCompletion(cfg, {
				messages: buildPromptV1(
					imageUrl,
					(input.candidates ?? []).map((p) => toModelSpace(p, canvas))
				),
				schemaName: 'floorplan_areas',
				jsonSchema: analyzeJsonSchemaV1 as unknown as Record<string, unknown>,
				validate: AnalyzeReplyV1
			});
			return { blueprint: blueprintFromAreas(reply.areas, input), source: 'ai' };
		}
		const reply = await structuredCompletion(cfg, {
			messages: buildPromptV2(imageUrl, input.rooms ?? [], canvas),
			schemaName: 'floorplan_rooms',
			jsonSchema: analyzeJsonSchemaV2 as unknown as Record<string, unknown>,
			validate: AnalyzeReplyV2
		});
		return { blueprint: blueprintFromRooms(reply, input), source: 'ai' };
	} catch (err) {
		const reason = err instanceof AiError ? err.message : err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'request failed';
		if (!(err instanceof AiError)) console.error('analyze failed', err);
		return {
			blueprint: fallbackBlueprint(input),
			source: 'fallback',
			warning: `AI analysis failed (${reason}); ${what} were added as unnamed areas.`
		};
	}
}
