import { asc } from 'drizzle-orm';
import { csvResponse, toCsv } from '$lib/server/csv';
import { db } from '$lib/server/db';
import { subscribers } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const rows = db().select().from(subscribers).orderBy(asc(subscribers.consentAt)).all();
	return csvResponse(
		toCsv([
			['email', 'consent_at', 'source'],
			...rows.map((s) => [s.email, s.consentAt.toISOString(), s.source])
		]),
		'subscribers.csv'
	);
};
