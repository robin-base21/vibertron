import type { FloorplanGeometry } from './pipeline';

export type WorkerRequest = { type: 'run'; bitmap: ImageBitmap };

export type WorkerResponse =
	| { type: 'progress'; stage: string; pct: number }
	| { type: 'result'; geometry: FloorplanGeometry; marked: Blob | null }
	| { type: 'error'; message: string };
