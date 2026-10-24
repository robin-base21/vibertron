import { Blueprint, type Point, type Segment } from 'common';
import { z } from 'zod';
import { baseBlueprint, clamp, makeSegment, nameDeduper, round, type BuildInput } from './draft';

// Legacy (v1) labelling: image + indexed candidate polygons -> named work areas with station
// estimates. Used when a client sends `candidates` but no v2 `rooms`.

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

export const AnalyzeReplyV1 = z.object({ areas: z.array(AnalyzedArea).max(200) });

export const analyzeJsonSchemaV1 = {
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

const SYSTEM_PROMPT_V1 = `You label venue floorplans for a hackathon seating tool.
You get a floorplan image and a list of candidate room polygons detected by computer vision, in a normalized 0..1000 coordinate system on both axes (x right, y down, image stretched to fill the square).
For every distinct area, return an entry:
- polygonIndex: the index of the matching candidate polygon, or null if no candidate matches.
- name: the label written on the plan if any, else a short descriptive name ("Main Hall", "Kitchen").
- isWorkArea: true only for areas where teams can sit at tables and work (halls, classrooms, open offices, labs). Corridors, toilets, kitchens, stairs and storage are false.
- suggestedStations: estimated number of seats for laptop work (0 if not a work area).
- confidence: how sure you are about the whole entry, 0..1.
- rect: when there are no candidates (or a work area has no matching candidate), set polygonIndex to null and give its bounding box {x, y, w, h} in 0..1000 coordinates; otherwise null.
Return JSON only.`;

/** `candidates` must already be in the model's 0..1000 space. */
export function buildPromptV1(imageUrl: string, candidates: Point[][]) {
	const list = candidates.length
		? candidates.map((poly, i) => `${i}: ${JSON.stringify(poly.map(round))}`).join('\n')
		: '(no candidates detected: propose rects for the work areas)';
	return [
		{ role: 'system' as const, content: SYSTEM_PROMPT_V1 },
		{
			role: 'user' as const,
			content: [
				{ type: 'text' as const, text: `Candidate polygons (${candidates.length}):\n${list}` },
				{ type: 'image_url' as const, image_url: { url: imageUrl } }
			]
		}
	];
}

/** Turn the model's areas into a draft blueprint: work areas become unconfirmed segments. */
export function blueprintFromAreas(areas: AnalyzedArea[], input: BuildInput): Blueprint {
	const bp = baseBlueprint(input);
	const candidates = input.candidates ?? [];
	const usedPolygons = new Set<number>();
	const uniqueName = nameDeduper();
	for (const a of areas) {
		if (!a.isWorkArea) continue;
		let shape: Segment['shape'];
		let points: Point[];
		const idx = a.polygonIndex;
		if (idx !== null && idx >= 0 && idx < candidates.length && !usedPolygons.has(idx)) {
			usedPolygons.add(idx);
			shape = 'polygon';
			points = candidates[idx]!.map(round);
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
		bp.segments.push(makeSegment(`s${bp.segments.length + 1}`, uniqueName(a.name), shape, points, a.suggestedStations, a.confidence));
	}
	return Blueprint.parse(bp);
}

/** No AI: every candidate polygon becomes an unnamed segment. */
export function fallbackBlueprintV1(input: BuildInput): Blueprint {
	const bp = baseBlueprint(input);
	bp.segments = (input.candidates ?? []).map((poly, i) => makeSegment(`s${i + 1}`, `Area ${i + 1}`, 'polygon', poly.map(round)));
	return Blueprint.parse(bp);
}
