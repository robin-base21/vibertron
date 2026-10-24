import { API_URL } from '$lib/env';

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, {
		credentials: 'include',
		...init,
		headers: { 'Content-Type': 'application/json', ...init.headers }
	});
	if (!res.ok) throw new ApiError(res.status, await res.text());
	return res.json() as Promise<T>;
}
