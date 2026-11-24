import { error, json } from '@sveltejs/kit';
import { AiError } from '$lib/server/ai';
import { FillRequest, fillEvent } from '$lib/server/aiFill';
import type { RequestHandler } from './$types';

/** Admin only (hooks guard /admin): AI suggestions for the event form; nothing is saved. */
export const POST: RequestHandler = async ({ request }) => {
	const parsed = FillRequest.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Bad request');
	try {
		return json(await fillEvent(parsed.data));
	} catch (err) {
		if (err instanceof AiError) return json({ error: err.message }, { status: 502 });
		throw err;
	}
};
