import { Blueprint, emptyBlueprint, centroid, type Point, type Segment } from './blueprint';

/*
Blueprint markup: one statement per line, `#` starts a comment.

  title "Vibeathon #3" date 2026-10-24 rev A
  segment "Hall A" rect 100,100 300x200 stations 12 grid [id seg_a] [label 250,200] [unconfirmed] [confidence 0.7]
  segment "Lounge" poly 500,100 800,100 800,400 stations 6 row

Outlines and the underlay are not part of the markup; they are preserved from the
base blueprint passed to `parseMarkup`.
*/

export interface MarkupError {
	line: number;
	message: string;
}

export type MarkupResult = { ok: true; blueprint: Blueprint } | { ok: false; errors: MarkupError[] };

const num = (n: number) => String(Math.round(n * 100) / 100);
const pt = (p: Point) => `${num(p[0])},${num(p[1])}`;
const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function serializeMarkup(bp: Blueprint): string {
	const t = bp.titleBlock;
	const lines = [`title ${quote(t.project)} date ${t.date} rev ${t.rev}`];
	for (const s of bp.segments) {
		let geom: string;
		if (s.shape === 'rect') {
			const [a, b] = s.points as [Point, Point];
			geom = `rect ${pt(a)} ${num(b[0] - a[0])}x${num(b[1] - a[1])}`;
		} else {
			geom = `poly ${s.points.map(pt).join(' ')}`;
		}
		let line = `segment ${quote(s.name)} ${geom} stations ${s.stations.count} ${s.stations.layout} id ${s.id} label ${pt(s.labelPos)}`;
		if (!s.stations.confirmed) line += ' unconfirmed';
		if (s.confidence !== undefined) line += ` confidence ${num(s.confidence)}`;
		lines.push(line);
	}
	return lines.join('\n') + '\n';
}

function tokenize(line: string): string[] {
	const tokens: string[] = [];
	const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line))) {
		if (m[2]?.startsWith('#')) break; // comment outside quotes
		tokens.push(m[1] !== undefined ? '"' + m[1].replace(/\\(.)/g, '$1') : m[2]!);
	}
	return tokens;
}

const isString = (t: string | undefined) => t?.startsWith('"');
const unq = (t: string) => t.slice(1);

function parsePoint(t: string | undefined): Point | null {
	const m = t && /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(t);
	return m ? [Number(m[1]), Number(m[2])] : null;
}

function parseSize(t: string | undefined): [number, number] | null {
	const m = t && /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(t);
	return m ? [Number(m[1]), Number(m[2])] : null;
}

function slug(name: string): string {
	return (
		'seg_' +
		(name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_|_$/g, '') || 'x')
	);
}

export function parseMarkup(src: string, base: Blueprint = emptyBlueprint()): MarkupResult {
	const errors: MarkupError[] = [];
	const segments: Segment[] = [];
	const titleBlock = { ...base.titleBlock };
	const usedIds = new Set<string>();

	src.split('\n').forEach((raw, i) => {
		const lineNo = i + 1;
		const err = (message: string) => errors.push({ line: lineNo, message });
		const line = raw.trim();
		const tk = tokenize(line);
		const head = tk.shift();
		if (head === undefined) return;

		if (head === 'title') {
			const name = tk.shift();
			if (!isString(name)) return err('title expects a quoted name');
			titleBlock.project = unq(name!);
			while (tk.length) {
				const key = tk.shift();
				const val = tk.shift();
				if (val === undefined) return err(`missing value for ${key}`);
				if (key === 'date') titleBlock.date = val;
				else if (key === 'rev') titleBlock.rev = val;
				else return err(`unknown title option "${key}"`);
			}
			return;
		}

		if (head !== 'segment') return err(`unknown statement "${head}"`);

		const name = tk.shift();
		if (!isString(name) || !unq(name!)) return err('segment expects a quoted name');
		const shapeTok = tk.shift();
		let shape: Segment['shape'];
		let points: Point[];
		if (shapeTok === 'rect') {
			const origin = parsePoint(tk.shift());
			const size = parseSize(tk.shift());
			if (!origin || !size) return err('rect expects "x,y WxH"');
			shape = 'rect';
			points = [origin, [origin[0] + size[0], origin[1] + size[1]]];
		} else if (shapeTok === 'poly') {
			points = [];
			while (tk.length && parsePoint(tk[0])) points.push(parsePoint(tk.shift())!);
			if (points.length < 3) return err('poly expects at least 3 points "x,y"');
			shape = 'polygon';
		} else {
			return err('expected "rect" or "poly"');
		}

		if (tk.shift() !== 'stations') return err('expected "stations <count> <grid|row>"');
		const count = Number(tk.shift());
		if (!Number.isInteger(count) || count < 0) return err('station count must be a non-negative integer');
		const layout = tk.shift();
		if (layout !== 'grid' && layout !== 'row') return err('station layout must be "grid" or "row"');

		let id: string | undefined;
		let labelPos: Point | undefined;
		let confirmed = true;
		let confidence: number | undefined;
		while (tk.length) {
			const key = tk.shift();
			if (key === 'unconfirmed') confirmed = false;
			else if (key === 'id') id = tk.shift();
			else if (key === 'label') {
				const p = parsePoint(tk.shift());
				if (!p) return err('label expects "x,y"');
				labelPos = p;
			} else if (key === 'confidence') {
				confidence = Number(tk.shift());
				if (!(confidence >= 0 && confidence <= 1)) return err('confidence must be between 0 and 1');
			} else return err(`unknown segment option "${key}"`);
		}

		let finalId = id ?? slug(unq(name!));
		if (usedIds.has(finalId)) {
			if (id) return err(`duplicate id "${id}"`);
			let n = 2;
			while (usedIds.has(`${finalId}_${n}`)) n++;
			finalId = `${finalId}_${n}`;
		}
		usedIds.add(finalId);

		segments.push({
			id: finalId,
			name: unq(name!),
			shape,
			points,
			labelPos: labelPos ?? centroid(points),
			stations: { count, layout, confirmed },
			...(confidence !== undefined ? { confidence } : {})
		});
	});

	if (errors.length) return { ok: false, errors };
	const parsed = Blueprint.safeParse({ ...base, segments, titleBlock });
	if (!parsed.success) {
		return { ok: false, errors: parsed.error.issues.map((i) => ({ line: 0, message: `${i.path.join('.')}: ${i.message}` })) };
	}
	return { ok: true, blueprint: parsed.data };
}
