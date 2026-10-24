/// <reference lib="webworker" />
// Floorplan detection worker. opencv.js (~13 MB) is only ever loaded here: this worker is spawned
// on demand by `detectFloorplan`, so the main bundle never includes it. A static import keeps the
// worker a single chunk (Vite's default iife worker format can't code-split).
import cvImport from '@techstark/opencv-js';
import { drawMarked } from './marked';
import { downscaleFactor, runPipeline } from './pipeline';
import type { WorkerRequest, WorkerResponse } from './protocol';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;

let cvPromise: Promise<CV> | null = null;

function post(msg: WorkerResponse) {
	self.postMessage(msg);
}

async function loadCv(): Promise<CV> {
	const cvModule: CV = cvImport;
	if (cvModule instanceof Promise) return await cvModule;
	if (cvModule.Mat) return cvModule;
	await new Promise<void>((resolve) => {
		cvModule.onRuntimeInitialized = () => resolve();
	});
	return cvModule;
}

async function run(bitmap: ImageBitmap) {
	post({ type: 'progress', stage: 'Loading OpenCV', pct: 5 });
	const cv = await (cvPromise ??= loadCv());

	post({ type: 'progress', stage: 'Preparing image', pct: 30 });
	const f = downscaleFactor(bitmap.width, bitmap.height);
	const w = Math.max(1, Math.round(bitmap.width * f));
	const h = Math.max(1, Math.round(bitmap.height * f));
	const source = new OffscreenCanvas(w, h);
	const ctx2d = source.getContext('2d')!;
	ctx2d.fillStyle = '#fff';
	ctx2d.fillRect(0, 0, w, h);
	ctx2d.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();
	const imageData = ctx2d.getImageData(0, 0, w, h);

	const geometry = runPipeline(cv, imageData, (stage, pct) => post({ type: 'progress', stage, pct }));

	post({ type: 'progress', stage: 'Marking rooms', pct: 97 });
	let marked: Blob | null = null;
	try {
		const out = new OffscreenCanvas(geometry.canvas.w, geometry.canvas.h);
		drawMarked(out.getContext('2d')!, source, geometry.envelope, geometry.canvas, geometry.rooms);
		marked = await out.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
	} catch {
		// the analyze step falls back to the original image
	}
	post({ type: 'result', geometry, marked });
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	if (e.data.type !== 'run') return;
	run(e.data.bitmap).catch((err) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};
