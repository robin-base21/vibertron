import type { AnalyzeBody, AnalyzeResultDTO, Blueprint, EventDTO, LiveSnapshotDTO } from 'common';
import { api, ApiError } from '$lib/api/client';
import { API_URL } from '$lib/env';

// Typed calls for the blueprint editor, floorplan import and live views.

export const underlayUrl = (imageRef: string) => `${API_URL}/api/uploads/${encodeURIComponent(imageRef)}`;

export const getEvent = (id: string) => api<{ event: EventDTO }>(`/api/events/${id}`);

export const getBlueprint = (eventId: string) =>
	api<{ blueprint: Blueprint | null; version: number }>(`/api/events/${eventId}/blueprint`);

export type SaveResult = { ok: true; version: number } | { ok: false; conflict: true };

/** PUT with optimistic version; a 409 is returned as `{ conflict: true }` instead of throwing. */
export async function saveBlueprint(eventId: string, blueprint: Blueprint, version: number): Promise<SaveResult> {
	try {
		const r = await api<{ version: number }>(`/api/events/${eventId}/blueprint`, {
			method: 'PUT',
			body: JSON.stringify({ blueprint, version })
		});
		return { ok: true, version: r.version };
	} catch (e) {
		if (e instanceof ApiError && e.status === 409) return { ok: false, conflict: true };
		throw e;
	}
}

/** Multipart upload; can't use `api()` because it forces a JSON content type. */
export async function uploadImage(eventId: string, file: Blob): Promise<{ imageRef: string }> {
	const form = new FormData();
	form.append('file', file);
	const res = await fetch(`${API_URL}/api/events/${eventId}/uploads`, {
		method: 'POST',
		credentials: 'include',
		body: form
	});
	if (!res.ok) throw new ApiError(res.status, await res.text());
	return res.json();
}

export const analyzeFloorplan = (eventId: string, body: AnalyzeBody) =>
	api<AnalyzeResultDTO>(`/api/events/${eventId}/blueprint/analyze`, {
		method: 'POST',
		body: JSON.stringify(body)
	});

export const getLive = (slug: string) => api<LiveSnapshotDTO>(`/api/e/${encodeURIComponent(slug)}/live`);

/** Pull a readable message out of an ApiError (body is ApiErrorBody JSON or text). */
export function errorMessage(e: unknown): string {
	if (e instanceof ApiError) {
		try {
			return (JSON.parse(e.message) as { message?: string }).message ?? e.message;
		} catch {
			return e.message || `HTTP ${e.status}`;
		}
	}
	return e instanceof Error ? e.message : String(e);
}
