import { TIME_ZONE } from './time';

const locale = 'en-US';
const timeZone = TIME_ZONE;

export const formatDate = (d: Date | null | undefined) =>
	d
		? d.toLocaleDateString(locale, {
				weekday: 'short',
				month: 'short',
				day: 'numeric',
				year: 'numeric',
				timeZone
			})
		: 'Date to be announced';

export const formatTime = (d: Date | null | undefined) =>
	d ? d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone }) : '';

export const formatDay = (d: Date | null | undefined) =>
	d
		? {
				month: d.toLocaleDateString(locale, { month: 'short', timeZone }).toUpperCase(),
				day: Number(d.toLocaleDateString(locale, { day: 'numeric', timeZone }))
			}
		: null;

export const paragraphs = (text: string | null | undefined) =>
	(text ?? '')
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean);

export const hostOf = (url: string) => {
	try {
		return new URL(url).host.replace(/^www\./, '');
	} catch {
		return url;
	}
};
