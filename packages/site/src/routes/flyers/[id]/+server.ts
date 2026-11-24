import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { isAdmin } from '$lib/server/admin';
import { db } from '$lib/server/db';
import { events } from '$lib/server/db/schema';
import { flyerById, flyerFile } from '$lib/server/flyers';
import { sniffImage } from '$lib/server/signups';
import type { RequestHandler } from './$types';

/** A flyer image: the public sees the chosen flyer of a published event; admins see every one. */
export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const id = params.id.replace(/\.(png|jpg|webp)$/, '');
	const flyer = flyerById(id);
	if (!flyer) error(404, 'Not found');
	const event = db().select().from(events).where(eq(events.id, flyer.eventId)).get();
	const admin = isAdmin(cookies);
	if (!admin && !(event?.published && event.flyerId === flyer.id)) error(404, 'Not found');
	const file = Bun.file(flyerFile(flyer.eventId, flyer.imageRef));
	if (!(await file.exists())) error(404, 'Not found');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const kind = sniffImage(bytes);
	const ext = kind?.ext ?? 'png';
	return new Response(bytes, {
		headers: {
			'Content-Type': kind?.type ?? 'image/png',
			'Cache-Control': admin ? 'private, max-age=3600' : 'public, max-age=86400',
			'X-Content-Type-Options': 'nosniff',
			...(url.searchParams.has('download')
				? { 'Content-Disposition': `attachment; filename="${event?.slug ?? 'flyer'}-flyer.${ext}"` }
				: {})
		}
	});
};
