import type { Blueprint } from 'common';
import { ApiError, blueprints } from '$lib/api';

// Blueprint-specific helpers on top of the typed wrappers in $lib/api.

export const underlayUrl = blueprints.uploadUrl;

export type SaveResult = { ok: true; version: number } | { ok: false; conflict: true };

/** PUT with optimistic version; a 409 is returned as `{ conflict: true }` instead of throwing. */
export async function saveBlueprint(eventId: string, blueprint: Blueprint, version: number): Promise<SaveResult> {
	try {
		const r = await blueprints.save(eventId, { blueprint, version });
		return { ok: true, version: r.version };
	} catch (e) {
		// A version mismatch carries `details.version`; other 409s (e.g. locked while live) are errors.
		const details = e instanceof ApiError ? (e.details as { version?: number } | undefined) : undefined;
		if (e instanceof ApiError && e.status === 409 && details?.version !== undefined) return { ok: false, conflict: true };
		throw e;
	}
}
