import type { ContourResult } from './geometry';

export type WorkerRequest = { type: 'run'; bitmap: ImageBitmap };

export type WorkerResponse =
	| { type: 'progress'; stage: string; pct: number }
	| ({ type: 'result' } & ContourResult)
	| { type: 'error'; message: string };
