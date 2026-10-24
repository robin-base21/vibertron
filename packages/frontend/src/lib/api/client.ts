import { API_URL } from '$lib/env';
import type { ApiErrorBody } from 'common';

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		/** Machine-readable error code from ApiErrorBody.error (e.g. 'capacity'). */
		public code: string = 'error',
		public details?: unknown
	) {
		super(message);
	}
}

export type Fetch = typeof fetch;

export interface RequestOptions {
	method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
	body?: unknown;
	/** Pass SvelteKit's `fetch` from load functions. */
	fetch?: Fetch;
}

async function toError(res: Response): Promise<ApiError> {
	const text = await res.text().catch(() => '');
	try {
		const body = JSON.parse(text) as Partial<ApiErrorBody>;
		if (body && typeof body.message === 'string')
			return new ApiError(res.status, body.message, body.error ?? 'error', body.details);
	} catch {
		// not JSON
	}
	return new ApiError(res.status, text || res.statusText || `HTTP ${res.status}`);
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
	const f = opts.fetch ?? fetch;
	const { body } = opts;
	const isForm = body instanceof FormData;
	let res: Response;
	try {
		res = await f(`${API_URL}${path}`, {
			method: opts.method ?? (body === undefined ? 'GET' : 'POST'),
			credentials: 'include',
			headers: body === undefined || isForm ? undefined : { 'Content-Type': 'application/json' },
			// Strings are sent as-is (already-serialized JSON), so callers may pass either form.
			body:
				body === undefined
					? undefined
					: isForm || typeof body === 'string'
						? body
						: JSON.stringify(body)
		});
	} catch {
		throw new ApiError(0, 'Cannot reach the server', 'network');
	}
	if (!res.ok) throw await toError(res);
	return res.json() as Promise<T>;
}
