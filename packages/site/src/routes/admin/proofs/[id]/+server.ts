import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { signups } from '$lib/server/db/schema';
import { proofPath, sniffImage } from '$lib/server/signups';
import type { RequestHandler } from './$types';

/** A signup's payment screenshot (admins only, via the /admin guard). */
export const GET: RequestHandler = async ({ params }) => {
	const row = db().select().from(signups).where(eq(signups.id, params.id)).get();
	const path = row && proofPath(row);
	const file = path ? Bun.file(path) : null;
	if (!file || !(await file.exists())) error(404, 'No screenshot');
	const bytes = new Uint8Array(await file.arrayBuffer());
	return new Response(bytes, {
		headers: {
			'Content-Type': sniffImage(bytes)?.type ?? 'application/octet-stream',
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
