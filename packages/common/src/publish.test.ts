import { expect, test } from 'bun:test';
import { PublishPayload, deckSignatureInput, sha256Hex, signPayload, verifyPayload } from './publish';

const payload = {
	version: 1,
	sentAt: 1,
	event: { id: 'e', slug: 'jam', name: 'Jam', startedAt: null, endedAt: null, participantCount: 4, teamCount: 2 },
	teams: [{ id: 't', name: 'Team 1', codename: 'Owls', color: '#d95926', striped: false }],
	projects: [{ id: 'p', teamId: 't', name: 'Thing', tagline: null, author: 'Ada', link: null, hasDeck: false }],
	ranking: [{ rank: 1, points: 3, teamId: 't', projectId: 'p' }]
};

test('payload schema accepts a full push', () => {
	expect(PublishPayload.safeParse(payload).success).toBe(true);
	expect(PublishPayload.safeParse({ ...payload, version: 2 }).success).toBe(false);
});

test('signatures verify only with the same secret and body', async () => {
	const body = JSON.stringify(payload);
	const sig = await signPayload('s3cret', body);
	expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
	expect(await verifyPayload('s3cret', body, sig)).toBe(true);
	expect(await verifyPayload('other', body, sig)).toBe(false);
	expect(await verifyPayload('s3cret', body + ' ', sig)).toBe(false);
	expect(await verifyPayload('s3cret', body, null)).toBe(false);
	expect(await verifyPayload('', body, sig)).toBe(false);
});

test('deck signatures bind event, project and exact bytes', async () => {
	const pdf = new TextEncoder().encode('%PDF-1.4 x');
	const hash = await sha256Hex(pdf);
	expect(hash).toMatch(/^[0-9a-f]{64}$/);
	const sig = await signPayload('k', deckSignatureInput('e1', 'p1', hash));
	expect(await verifyPayload('k', deckSignatureInput('e1', 'p1', hash), sig)).toBe(true);
	expect(await verifyPayload('k', deckSignatureInput('e1', 'p2', hash), sig)).toBe(false);
	const other = await sha256Hex(new TextEncoder().encode('%PDF-1.4 y'));
	expect(await verifyPayload('k', deckSignatureInput('e1', 'p1', other), sig)).toBe(false);
});
