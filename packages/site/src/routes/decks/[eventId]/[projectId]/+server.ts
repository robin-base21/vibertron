import { error } from '@sveltejs/kit';
import { manualDeckPath } from '$lib/server/manualProjects';
import { deckPath } from '$lib/server/results';
import type { RequestHandler } from './$types';

/** A showcased project's slides: published from the event app, or uploaded with a manual project. */
export const GET: RequestHandler = async ({ params }) => {
	const projectId = params.projectId.replace(/\.pdf$/, '');
	// Published slides first, then slides of a project added by hand on the site.
	let file = null;
	for (const path of [
		deckPath(params.eventId, projectId),
		manualDeckPath(params.eventId, projectId)
	]) {
		const f = path ? Bun.file(path) : null;
		if (f && (await f.exists())) {
			file = f;
			break;
		}
	}
	if (!file) error(404, 'No slides');
	return new Response(file, {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': 'inline',
			'Cache-Control': 'public, max-age=300',
			'X-Content-Type-Options': 'nosniff',
			// PDFs can carry scripts; never let one run with the site's origin.
			'Content-Security-Policy': 'sandbox'
		}
	});
};
