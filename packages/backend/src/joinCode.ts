import { createHmac } from 'node:crypto';
import { bytesToCode, joinCodeWindow } from 'common';

export function joinCodeFor(secret: string, window: number): string {
	return bytesToCode(createHmac('sha256', secret).update(String(window)).digest());
}

/** Accepts the code of the current and the previous window. */
export function verifyJoinCode(secret: string, code: string, now = Date.now()): boolean {
	const w = joinCodeWindow(now);
	const normalized = code.trim().toUpperCase();
	return normalized === joinCodeFor(secret, w) || normalized === joinCodeFor(secret, w - 1);
}
