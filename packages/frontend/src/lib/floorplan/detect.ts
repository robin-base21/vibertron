import type { FloorplanGeometry } from './pipeline';
import type { WorkerRequest, WorkerResponse } from './protocol';

export const DETECT_TIMEOUT_MS = 20_000;

export interface DetectRun {
	/** Null when the worker failed or timed out. */
	geometry: FloorplanGeometry | null;
	/** Set-of-Marks JPEG for the vision model. */
	marked: Blob | null;
	error?: string;
}

/**
 * Run the floorplan CV pipeline in a Web Worker. Never rejects: on failure or after the timeout it
 * resolves without geometry, so the import can continue with AI-only / manual drawing.
 */
export async function detectFloorplan(
	file: Blob,
	onProgress: (stage: string, pct: number) => void = () => {},
	timeoutMs = DETECT_TIMEOUT_MS
): Promise<DetectRun> {
	const fail = (error: string): DetectRun => ({ geometry: null, marked: null, error });
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return fail('Could not decode the image');
	}

	let worker: Worker;
	try {
		worker = new Worker(new URL('./detect.worker.ts', import.meta.url), { type: 'module' });
	} catch (e) {
		bitmap.close();
		return fail(e instanceof Error ? e.message : 'Web Workers are unavailable');
	}

	return new Promise<DetectRun>((resolve) => {
		const done = (r: DetectRun) => {
			clearTimeout(timer);
			worker.terminate();
			resolve(r);
		};
		const timer = setTimeout(() => done(fail('Detection timed out')), timeoutMs);
		worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
			const m = e.data;
			if (m.type === 'progress') onProgress(m.stage, m.pct);
			else if (m.type === 'result') done({ geometry: m.geometry, marked: m.marked });
			else done(fail(m.message));
		};
		worker.onerror = (e) => done(fail(e.message || 'Detection worker crashed'));
		const req: WorkerRequest = { type: 'run', bitmap };
		worker.postMessage(req, [bitmap]);
	});
}
