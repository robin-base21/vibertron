import type { ApiErrorBody } from 'common';
import type { z } from 'zod';

export class HttpError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
		public details?: unknown
	) {
		super(message);
	}
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Not signed in') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Forbidden') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, 'conflict', message, details);

export function json(data: unknown, init: ResponseInit = {}): Response {
	return Response.json(data, init);
}

export function errorResponse(err: unknown): Response {
	if (err instanceof HttpError) {
		const body: ApiErrorBody = { error: err.code, message: err.message };
		if (err.details !== undefined) body.details = err.details;
		return Response.json(body, { status: err.status });
	}
	console.error(err);
	const body: ApiErrorBody = { error: 'internal', message: 'Internal server error' };
	return Response.json(body, { status: 500 });
}

/** Parse and validate a JSON body against a zod schema; 400 on failure. */
export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
	let raw: unknown;
	try {
		const text = await req.text();
		raw = text ? JSON.parse(text) : {};
	} catch {
		throw badRequest('Invalid JSON body');
	}
	const result = schema.safeParse(raw);
	if (!result.success) throw new HttpError(400, 'validation', 'Invalid request body', result.error.issues);
	return result.data;
}

export function corsHeaders(origin: string): Record<string, string> {
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Credentials': 'true',
		'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '600',
		Vary: 'Origin'
	};
}

export function withHeaders(res: Response, headers: Record<string, string>): Response {
	for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
	return res;
}

export function parseCookies(header: string | null): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(';')) {
		const i = part.indexOf('=');
		if (i < 0) continue;
		const k = part.slice(0, i).trim();
		if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
	}
	return out;
}
