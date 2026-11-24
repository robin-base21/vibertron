import { error } from '@sveltejs/kit';
import { join } from 'node:path';
import { previewDir } from '$lib/server/previews';
import type { RequestHandler } from './$types';

const TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp'
};

/** Stored link preview images (names are hashes, so the content of a name never changes). */
export const GET: RequestHandler = async ({ params }) => {
	const m = /^([a-f0-9]{32})\.(png|jpg|gif|webp)$/.exec(params.file);
	if (!m) error(404, 'Not found');
	const file = Bun.file(join(previewDir(), params.file));
	if (!(await file.exists())) error(404, 'Not found');
	return new Response(file, {
		headers: {
			'Content-Type': TYPES[m[2]!]!,
			'Cache-Control': 'public, max-age=86400',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
