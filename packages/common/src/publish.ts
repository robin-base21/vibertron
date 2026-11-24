import { z } from 'zod';

/*
Vibertron -> public site: the only integration. After the winner is revealed a manager presses
"Publish to site", and Vibertron sends:
  1. POST {SITE_PUBLISH_URL}                                   body: PublishPayload as JSON
     header X-Vibertron-Signature: sha256=<hex HMAC-SHA256 of the raw body with the shared secret>
  2. PUT {SITE_PUBLISH_URL}/decks/<event.id>/<project.id>      body: the PDF (application/pdf)
     header X-Vibertron-Signature: signature of deckSignatureInput(event.id, project.id, sha256 of the PDF)
     once per project in the payload with hasDeck.
Re-publishing sends the full, current state again; the site replaces what it had for event.id (step 1
clears its slides, step 2 brings them back). Neither request is a "form" content type, so SvelteKit's
CSRF origin check doesn't apply to these server-to-server calls.
Only projects whose author chose to be shown publicly appear, and only their authors' names.
*/

export const PUBLISH_SIGNATURE_HEADER = 'x-vibertron-signature';
/** Pushes older than this are rejected (replay protection). */
export const PUBLISH_MAX_AGE_MS = 10 * 60_000;

export const PublishedProject = z.object({
	id: z.string(),
	teamId: z.string(),
	name: z.string(),
	tagline: z.string().nullable(),
	author: z.string(),
	link: z.string().nullable(),
	hasDeck: z.boolean()
});
export type PublishedProject = z.infer<typeof PublishedProject>;

export const PublishPayload = z.object({
	version: z.literal(1),
	sentAt: z.number().int(),
	event: z.object({
		id: z.string(),
		slug: z.string(),
		name: z.string(),
		startedAt: z.number().int().nullable(),
		endedAt: z.number().int().nullable(),
		participantCount: z.number().int(),
		teamCount: z.number().int()
	}),
	teams: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			codename: z.string().nullable(),
			/** Team colour (hex), as on the venue TV. */
			color: z.string(),
			striped: z.boolean()
		})
	),
	/** Projects whose authors agreed to the public showcase. */
	projects: z.array(PublishedProject),
	/** Final pitch ranking. projectId is null for a project whose author kept it private. */
	ranking: z.array(
		z.object({
			rank: z.number().int(),
			points: z.number(),
			teamId: z.string(),
			projectId: z.string().nullable()
		})
	)
});
export type PublishPayload = z.infer<typeof PublishPayload>;

const encoder = new TextEncoder();

async function hmacHex(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
	return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hex SHA-256 of bytes (used to sign a slide deck). */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer> | ArrayBuffer): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** What a deck upload's signature covers: which project, and exactly which bytes. */
export const deckSignatureInput = (eventId: string, projectId: string, pdfSha256: string) =>
	`deck:${eventId}:${projectId}:${pdfSha256}`;

/** Header value for a payload string. */
export async function signPayload(secret: string, body: string): Promise<string> {
	return `sha256=${await hmacHex(secret, body)}`;
}

/** Constant-time check of a signature header against the payload string. */
export async function verifyPayload(secret: string, body: string, header: string | null): Promise<boolean> {
	if (!secret || !header) return false;
	const expected = await signPayload(secret, body);
	if (expected.length !== header.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
	return diff === 0;
}
