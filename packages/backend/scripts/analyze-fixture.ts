// Dev helper: run the analyze step against a local image + rooms file and print the model reply.
//
//   bun run analyze:fixture <image> <rooms.json> [--marked <marked-image>]
//
// rooms.json uses the AnalyzeBody shape without refs: { canvas?, crop?, rooms, walls?, candidates?, outlines? }.
// Without OPENROUTER_API_KEY nothing is sent: the prompt and the fallback draft are printed instead.
import { AnalyzeBody, type Blueprint } from 'common';
import { parseArgs } from 'node:util';
import { analyzeFloorplan, buildPromptV2, isLegacy } from '../src/ai/analyze';
import type { BuildInput } from '../src/ai/draft';
import { sniffImageType } from '../src/routes/blueprints';
import { loadEnv } from '../src/env';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { marked: { type: 'string' } } });
const [imagePath, roomsPath] = positionals;
if (!imagePath || !roomsPath) {
	console.error('usage: bun run analyze:fixture <image> <rooms.json> [--marked <marked-image>]');
	process.exit(1);
}

async function readImage(path: string) {
	const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
	const contentType = sniffImageType(bytes);
	if (!contentType) throw new Error(`${path}: not a PNG/JPEG/GIF/WebP image`);
	return { bytes, contentType };
}

const body = AnalyzeBody.extend({ imageRef: AnalyzeBody.shape.imageRef.default('local-fixture') }).parse(await Bun.file(roomsPath).json());
const shown = await readImage(values.marked ?? imagePath);
const input: BuildInput = { ...body, project: 'Fixture', imageRef: body.imageRef };
const env = loadEnv();

function summarize(bp: Blueprint) {
	console.log(`\ncanvas ${bp.canvas.w}x${bp.canvas.h} · ${bp.walls.length} walls · ${bp.segments.length} segments · ${bp.outlines.length} outlines`);
	for (const s of bp.segments) console.log(`  segment ${s.id.padEnd(4)} ${s.name.padEnd(28)} ${s.shape.padEnd(7)} conf ${s.confidence ?? '-'}  ${JSON.stringify(s.points)}`);
	for (const o of bp.outlines.filter((o) => o.kind === 'room')) console.log(`  outline ${o.id.padEnd(4)} ${(o.label ?? '(unlabelled)').padEnd(28)} ${JSON.stringify(o.points)}`);
}

if (!env.openrouterApiKey) {
	console.log('OPENROUTER_API_KEY is not set: dry run, nothing is sent.\n');
	if (!isLegacy(input)) {
		const [system, user] = buildPromptV2('data:…', input.rooms ?? [], input.canvas ?? { w: 1000, h: 1000 });
		console.log('--- system\n' + system!.content);
		console.log('--- user\n' + (user!.content as { type: string; text?: string }[]).map((p) => p.text ?? `[${p.type}]`).join('\n'));
	}
}

// Log the raw assistant content of every call (including the retry).
const loggingFetch = (async (url: string, init: RequestInit) => {
	const res = await fetch(url, init);
	const text = await res.text();
	try {
		const content = JSON.parse(text).choices?.[0]?.message?.content;
		console.log(`--- reply (HTTP ${res.status})\n${content ?? text}`);
	} catch {
		console.log(`--- reply (HTTP ${res.status})\n${text}`);
	}
	return new Response(text, { status: res.status, headers: res.headers });
}) as unknown as typeof fetch;

const started = performance.now();
const result = await analyzeFloorplan({ apiKey: env.openrouterApiKey, model: env.openrouterModel, fetch: loggingFetch }, shown, input);
console.log(`\nsource ${result.source} · model ${env.openrouterModel} · ${Math.round(performance.now() - started)} ms`);
if (result.warning) console.log(`warning: ${result.warning}`);
summarize(result.blueprint);
