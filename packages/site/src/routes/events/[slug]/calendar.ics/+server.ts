import { error } from '@sveltejs/kit';
import { eventBySlug } from '$lib/server/events';
import type { RequestHandler } from './$types';

const ics = (d: Date) =>
	d
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
const escape = (s: string) =>
	s
		.replace(/\\/g, '\\\\')
		.replace(/[,;]/g, (c) => `\\${c}`)
		.replace(/\n/g, '\\n');

/** "Add to calendar" for a signed-up attendee. */
export const GET: RequestHandler = ({ params, url }) => {
	const found = eventBySlug(params.slug);
	if (!found?.event.published || !found.event.startsAt) error(404, 'Event not found');
	const { event } = found;
	const end = event.endsAt ?? new Date(event.startsAt!.getTime() + 3 * 3_600_000);
	const body = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//OurBusan.vibe//Site//EN',
		'BEGIN:VEVENT',
		`UID:${event.id}@${url.host}`,
		`DTSTAMP:${ics(new Date())}`,
		`DTSTART:${ics(event.startsAt!)}`,
		`DTEND:${ics(end)}`,
		`SUMMARY:${escape(event.name)}`,
		...(event.venue ? [`LOCATION:${escape(event.venue)}`] : []),
		...(event.venueUrl ? [`DESCRIPTION:${escape(`Location: ${event.venueUrl}`)}`] : []),
		`URL:${url.origin}/events/${event.slug}`,
		'END:VEVENT',
		'END:VCALENDAR'
	].join('\r\n');
	return new Response(body + '\r\n', {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': `attachment; filename="${event.slug}.ics"`
		}
	});
};
