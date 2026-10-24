import { Blueprint, centroid, type AnalyzeResultDTO, type Outline, type Point, type Segment } from 'common';
import { z } from 'zod';
import { AiError, imageDataUrl, structuredCompletion, type OpenRouterConfig } from './openrouter';

// Floorplan labelling: image + indexed candidate polygons -> named work areas.

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const AnalyzedArea = z.object({
	polygonIndex: z.number().int().nullable(),
	name: z
		.string()
		.trim()
		.min(1)
		.transform((s) => s.slice(0, 60)),
	isWorkArea: z.boolean(),
	suggestedStations: z
		.number()
		.int()
		.min(0)
		.transform((n) => Math.min(n, 500)),
	confidence: z.number().transform((c) => clamp(c, 0, 1)),
	rect: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).nullable().optional()
});
export type AnalyzedArea = z.infer<typeof AnalyzedArea>;

export const AnalyzeReply = z.object({ areas: z.array(AnalyzedArea).max(200) });

export const analyzeJsonSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['areas'],
	properties: {
		areas: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['polygonIndex', 'name', 'isWorkArea', 'suggestedStations', 'confidence', 'rect'],
				properties: {
					polygonIndex: { type: ['integer', 'null'], description: 'Index of the candidate polygon, or null when proposing a rect' },
					name: { type: 'string', description: 'Short room/area label, e.g. "Hall A"' },
					isWorkArea: { type: 'boolean', description: 'True if teams can sit and work here' },
					suggestedStations: { type: 'integer', description: 'Estimated number of seats/workstations' },
					confidence: { type: 'number', description: '0..1' },
					rect: {
						type: ['object', 'null'],
						additionalProperties: false,
						required: ['x', 'y', 'w', 'h'],
						properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
						description: 'Only when polygonIndex is null: bounding box in 0..1000 canvas coordinates'
					}
				}
			}
		}
	}
} as const;

const SYSTEM_PROMPT = `You label venue floorplans for a hackathon seating tool.
You get a floorplan image and a list of candidate room polygons detected by computer vision, in a normalized 0..1000 coordinate system on both axes (x right, y down, image stretched to fill the square).
For every distinct area, return an entry:
- polygonIndex: the index of the matching candidate polygon, or null if no candidate matches.
- name: the label written on the plan if any, else a short descriptive name ("Main Hall", "Kitchen").
- isWorkArea: true only for areas where teams can sit at tables and work (halls, classrooms, open offices, labs). Corridors, toilets, kitchens, stairs and storage are false.
- suggestedStations: estimated number of seats for laptop work (0 if not a work area).
- confidence: how sure you are about the whole entry, 0..1.
- rect: when there are no candidates (or a work area has no matching candidate), set polygonIndex to null and give its bounding box {x, y, w, h} in 0..1000 coordinates; otherwise null.
Return JSON only.`;

const round = (p: Point): Point => [Math.round(p[0]), Math.round(p[1])];

export function buildPrompt(imageUrl: string, candidates: Point[][]) {
	const list = candidates.length
		? candidates.map((poly, i) => `${i}: ${JSON.stringify(poly.map(round))}`).join('\n')
		: '(no candidates detected: propose rects for the work areas)';
	return [
		{ role: 'system' as const, content: SYSTEM_PROMPT },
		{
			role: 'user' as const,
			content: [
				{ type: 'text' as const, text: `Candidate polygons (${candidates.length}):\n${list}` },
				{ type: 'image_url' as const, image_url: { url: imageUrl } }
			]
		}
	];
}

export interface BuildInput {
	/** Candidate polygons in canvas coordinates. */
	candidates: Point[][];
	outlines: Point[][];
	imageRef: string;
	project: string;
	date?: string;
	/** Canvas the candidates/outlines use; defaults to 1000x1000. */
	canvas?: { w: number; h: number };
}

const canvasOf = (input: BuildInput) => input.canvas ?? { w: 1000, h: 1000 };

/** Canvas coordinates -> the square 0..1000 space the model works in. */
export function toModelSpace(points: Point[], canvas: { w: number; h: number }): Point[] {
	return points.map(([x, y]) => [(x * 1000) / canvas.w, (y * 1000) / canvas.h]);
}

function baseBlueprint(input: BuildInput): Blueprint {
	return {
		schemaVersion: 1,
		canvas: canvasOf(input),
		walls: [],
		underlay: { imageRef: input.imageRef, opacity: 0.35 },
		outlines: input.outlines.map(
			(points, i): Outline => ({ id: `o${i + 1}`, kind: 'wall', points: points.map(round), closed: points.length > 2 })
		),
		segments: [],
		titleBlock: { project: input.project, date: input.date ?? new Date().toISOString().slice(0, 10), rev: 'A' }
	};
}

function segment(id: string, name: string, shape: Segment['shape'], points: Point[], count: number, confidence?: number): Segment {
	const s: Segment = { id, name, shape, points, labelPos: round(centroid(points)), stations: { count, layout: 'grid', confirmed: false } };
	if (confidence !== undefined) s.confidence = confidence;
	return s;
}

/** Turn the model's areas into a draft blueprint: work areas become unconfirmed segments. */
export function blueprintFromAreas(areas: AnalyzedArea[], input: BuildInput): Blueprint {
	const bp = baseBlueprint(input);
	const usedPolygons = new Set<number>();
	const usedNames = new Map<string, number>();
	const uniqueName = (name: string) => {
		const n = (usedNames.get(name.toLowerCase()) ?? 0) + 1;
		usedNames.set(name.toLowerCase(), n);
		return n === 1 ? name : `${name.slice(0, 56)} ${n}`;
	};
	for (const a of areas) {
		if (!a.isWorkArea) continue;
		let shape: Segment['shape'];
		let points: Point[];
		const idx = a.polygonIndex;
		if (idx !== null && idx >= 0 && idx < input.candidates.length && !usedPolygons.has(idx)) {
			usedPolygons.add(idx);
			shape = 'polygon';
			points = input.candidates[idx]!.map(round);
		} else if (a.rect) {
			// The model answers in the square 0..1000 space; scale onto the canvas.
			const sx = bp.canvas.w / 1000;
			const sy = bp.canvas.h / 1000;
			const x = clamp(a.rect.x * sx, 0, bp.canvas.w);
			const y = clamp(a.rect.y * sy, 0, bp.canvas.h);
			const x2 = clamp((a.rect.x + a.rect.w) * sx, 0, bp.canvas.w);
			const y2 = clamp((a.rect.y + a.rect.h) * sy, 0, bp.canvas.h);
			if (x2 - x < 1 || y2 - y < 1) continue;
			shape = 'rect';
			points = [round([x, y]), round([x2, y2])];
		} else continue;
		bp.segments.push(segment(`s${bp.segments.length + 1}`, uniqueName(a.name), shape, points, a.suggestedStations, a.confidence));
	}
	return Blueprint.parse(bp);
}

/** No AI: every candidate polygon becomes an unnamed segment. */
export function fallbackBlueprint(input: BuildInput): Blueprint {
	const bp = baseBlueprint(input);
	bp.segments = input.candidates.map((poly, i) => segment(`s${i + 1}`, `Area ${i + 1}`, 'polygon', poly.map(round), 0));
	return Blueprint.parse(bp);
}

export async function analyzeFloorplan(
	cfg: OpenRouterConfig,
	image: { bytes: Uint8Array; contentType: string },
	input: BuildInput
): Promise<AnalyzeResultDTO> {
	if (!cfg.apiKey) {
		return { blueprint: fallbackBlueprint(input), source: 'fallback', warning: 'AI is not configured; candidate polygons were added as unnamed areas.' };
	}
	try {
		const reply = await structuredCompletion(cfg, {
			messages: buildPrompt(
				imageDataUrl(image.bytes, image.contentType),
				input.candidates.map((p) => toModelSpace(p, canvasOf(input)))
			),
			schemaName: 'floorplan_areas',
			jsonSchema: analyzeJsonSchema as unknown as Record<string, unknown>,
			validate: AnalyzeReply
		});
		return { blueprint: blueprintFromAreas(reply.areas, input), source: 'ai' };
	} catch (err) {
		const reason = err instanceof AiError ? err.message : err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'request failed';
		if (!(err instanceof AiError)) console.error('analyze failed', err);
		return {
			blueprint: fallbackBlueprint(input),
			source: 'fallback',
			warning: `AI analysis failed (${reason}); candidate polygons were added as unnamed areas.`
		};
	}
}
