import { canvasFor, type ContourResult } from './geometry';
import type { WorkerRequest, WorkerResponse } from './protocol';

export const CONTOUR_TIMEOUT_MS = 20_000;

export interface ContourRun extends ContourResult {
	/** Set when the worker failed or timed out; candidates/outlines are then empty. */
	error?: string;
}

/**
 * Run the OpenCV contour pass in a Web Worker. Never rejects: on failure or after the timeout
 * it resolves with empty candidates so the import can continue with AI-only / manual drawing.
 */
export async function detectContours(
	file: Blob,
	onProgress: (stage: string, pct: number) => void = () => {},
	timeoutMs = CONTOUR_TIMEOUT_MS
): Promise<ContourRun> {
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return { canvas: { w: 1000, h: 1000 }, candidates: [], outlines: [], error: 'Could not decode the image' };
	}
	const fallback = (error: string, canvas = canvasFor(bitmap.width || 1, bitmap.height || 1)): ContourRun => ({
		canvas,
		candidates: [],
		outlines: [],
		error
	});
	const canvas = canvasFor(bitmap.width, bitmap.height);

	let worker: Worker;
	try {
		worker = new Worker(new URL('./contours.worker.ts', import.meta.url), { type: 'module' });
	} catch (e) {
		bitmap.close();
		return fallback(e instanceof Error ? e.message : 'Web Workers are unavailable', canvas);
	}

	return new Promise<ContourRun>((resolve) => {
		const done = (r: ContourRun) => {
			clearTimeout(timer);
			worker.terminate();
			resolve(r);
		};
		const timer = setTimeout(() => done(fallback('Contour detection timed out', canvas)), timeoutMs);
		worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
			const m = e.data;
			if (m.type === 'progress') onProgress(m.stage, m.pct);
			else if (m.type === 'result') done({ canvas: m.canvas, candidates: m.candidates, outlines: m.outlines });
			else done(fallback(m.message, canvas));
		};
		worker.onerror = (e) => done(fallback(e.message || 'Contour worker crashed', canvas));
		const req: WorkerRequest = { type: 'run', bitmap };
		worker.postMessage(req, [bitmap]);
	});
}
