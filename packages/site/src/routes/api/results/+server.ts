import { PUBLISH_SIGNATURE_HEADER } from 'common';
import { json } from '@sveltejs/kit';
import { PublishError, receiveResults } from '$lib/server/results';
import type { RequestHandler } from './$types';

/** Vibertron's "Publish to site", step 1: the results as signed JSON (see common/src/publish.ts). */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const slug = await receiveResults(
			await request.text(),
			request.headers.get(PUBLISH_SIGNATURE_HEADER)
		);
		return json({ ok: true, slug });
	} catch (err) {
		if (err instanceof PublishError)
			return json({ ok: false, message: err.message }, { status: err.status });
		throw err;
	}
};
