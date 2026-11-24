import { env } from '$env/dynamic/public';

/** Events happen in one place: show and enter times in its timezone, whatever the server's is. */
export const TIME_ZONE = env.PUBLIC_SITE_TIMEZONE || 'Asia/Seoul';

/** Offset of TIME_ZONE from UTC at `date`, in ms. */
function zoneOffsetMs(date: Date): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: TIME_ZONE,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(date);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return (
		Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) -
		date.getTime()
	);
}

/** `<input type="datetime-local">` value (wall time in TIME_ZONE) -> Date. */
export function fromLocalInput(value: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
	if (!m) return null;
	const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
	return new Date(wall - zoneOffsetMs(new Date(wall)));
}

/** Date -> `<input type="datetime-local">` value in TIME_ZONE. */
export function toLocalInput(date: Date | null): string {
	return date ? new Date(date.getTime() + zoneOffsetMs(date)).toISOString().slice(0, 16) : '';
}
