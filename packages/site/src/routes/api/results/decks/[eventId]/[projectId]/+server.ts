import { PUBLISH_SIGNATURE_HEADER } from 'common';
import { json } from '@sveltejs/kit';
import { PublishError, receiveDeck } from '$lib/server/results';
import type { RequestHandler } from './$types';

/** Vibertron's "Publish to site", step 2: one project's slides as a signed raw PDF body. */
export const PUT: RequestHandler = async ({ request, params }) => {
	try {
		const bytes = new Uint8Array(await request.arrayBuffer());
		await receiveDeck(
			params.eventId,
			params.projectId,
			bytes,
			request.headers.get(PUBLISH_SIGNATURE_HEADER)
		);
		return json({ ok: true });
	} catch (err) {
		if (err instanceof PublishError)
			return json({ ok: false, message: err.message }, { status: err.status });
		throw err;
	}
};
