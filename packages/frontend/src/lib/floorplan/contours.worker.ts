/// <reference lib="webworker" />
// Floorplan contour pass. opencv.js (~13 MB) is only ever loaded here: this worker is spawned on
// demand by `detectContours`, so the main bundle never includes it. A static import keeps the
// worker a single chunk (Vite's default iife worker format can't code-split).
import cvImport from '@techstark/opencv-js';
import { downscaleFactor, filterContours, unflatten, type ContourInput } from './geometry';
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

	post({ type: 'progress', stage: 'Preparing image', pct: 35 });
	const f = downscaleFactor(bitmap.width, bitmap.height);
	const w = Math.max(1, Math.round(bitmap.width * f));
	const h = Math.max(1, Math.round(bitmap.height * f));
	const canvas = new OffscreenCanvas(w, h);
	const ctx2d = canvas.getContext('2d')!;
	ctx2d.fillStyle = '#fff';
	ctx2d.fillRect(0, 0, w, h);
	ctx2d.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();
	const imageData = ctx2d.getImageData(0, 0, w, h);

	const mats: { delete(): void }[] = [];
	const track = <T extends { delete(): void }>(m: T) => (mats.push(m), m);
	try {
		const src = track(cv.matFromImageData(imageData));
		const gray = track(new cv.Mat());
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
		cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0);

		post({ type: 'progress', stage: 'Thresholding', pct: 50 });
		const bin = track(new cv.Mat());
		const block = Math.max(15, Math.round(Math.max(w, h) / 50)) | 1;
		cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, block, 10);
		const k = Math.max(3, Math.round(Math.max(w, h) / 300)) | 1;
		const kernel = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k)));
		cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kernel);

		post({ type: 'progress', stage: 'Finding contours', pct: 65 });
		const contours = track(new cv.MatVector());
		const hierarchy = track(new cv.Mat());
		cv.findContours(bin, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

		post({ type: 'progress', stage: 'Simplifying', pct: 80 });
		const minLen = 0.02 * Math.hypot(w, h);
		const raw: ContourInput[] = [];
		const n = contours.size();
		for (let i = 0; i < n; i++) {
			const c = contours.get(i);
			const len = cv.arcLength(c, true);
			if (len >= minLen) {
				const approx = new cv.Mat();
				cv.approxPolyDP(c, approx, 0.012 * len, true);
				raw.push({ points: unflatten(approx.data32S), parent: hierarchy.data32S[i * 4 + 3] });
				approx.delete();
			}
			c.delete();
		}

		post({ type: 'progress', stage: 'Filtering', pct: 95 });
		const result = filterContours(raw, { w, h });
		post({ type: 'result', ...result });
	} finally {
		for (const m of mats) m.delete();
	}
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	if (e.data.type !== 'run') return;
	run(e.data.bitmap).catch((err) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};
