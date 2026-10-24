// Rotating venue join code. The HMAC itself is computed server-side only;
// this module holds the shared window math and alphabet.

export const JOIN_CODE_WINDOW_MS = 30_000;
export const JOIN_CODE_LENGTH = 6;
/** No 0/O/1/I to keep codes readable from a TV across a room. */
export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function joinCodeWindow(now: number = Date.now()): number {
	return Math.floor(now / JOIN_CODE_WINDOW_MS);
}

export function windowStart(window: number): number {
	return window * JOIN_CODE_WINDOW_MS;
}

/** Map arbitrary bytes onto the code alphabet. */
export function bytesToCode(bytes: Uint8Array, length = JOIN_CODE_LENGTH): string {
	let out = '';
	for (let i = 0; i < length; i++) out += JOIN_CODE_ALPHABET[bytes[i]! % JOIN_CODE_ALPHABET.length];
	return out;
}
