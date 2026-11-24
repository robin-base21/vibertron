import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { db } from './db';
import { linkPreviews } from './db/schema';
import { siteEnv } from './env';
import { safeGet } from './safeFetch';
import { sniffImage } from './signups';

// Project cards show the preview image (og:image) of the project's link. It is fetched in the
// background the first time a link shows up, stored on our server (links rot, and visitors' browsers
// shouldn't call random sites), and served from /previews/<file>. Until then, or when a page has none,
// the card shows a gradient.

const PAGE_MAX = 1024 * 1024;
const IMAGE_MAX = 5 * 1024 * 1024;
/** Retry pages without an image after a week, failures after a day. */
const RETRY_MS = { none: 7 * 86_400_000, error: 86_400_000 } as const;

export const previewDir = () => resolve(siteEnv.dataDir, 'previews');
const fileBase = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 32);

/** The og:image (or twitter:image) of an HTML page, as an absolute URL. */
export function findPreviewImage(html: string, base: URL): string | null {
	const head = html.slice(0, PAGE_MAX);
	for (const meta of head.match(/<meta\b[^>]*>/gi) ?? []) {
		const attr = (n: string) =>
			new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(meta);
		const key = attr('property') ?? attr('name');
		const name = (key?.[2] ?? key?.[3] ?? key?.[4] ?? '').toLowerCase();
		if (
			![
				'og:image',
				'og:image:url',
				'og:image:secure_url',
				'twitter:image',
				'twitter:image:src'
			].includes(name)
		)
			continue;
		const content = attr('content');
		const value = (content?.[2] ?? content?.[3] ?? content?.[4] ?? '')
			.trim()
			.replace(/&amp;/g, '&');
		if (!value) continue;
		try {
			const abs = new URL(value, base);
			if (abs.protocol === 'http:' || abs.protocol === 'https:') return abs.toString();
		} catch {
			/* next */
		}
	}
	return null;
}

async function fetchPreview(url: string) {
	const now = new Date();
	const save = (v: { imageRef: string | null; status: 'ok' | 'none' | 'error'; error?: string }) =>
		db()
			.insert(linkPreviews)
			.values({ url, fetchedAt: now, error: v.error ?? null, ...v })
			.onConflictDoUpdate({
				target: linkPreviews.url,
				set: { fetchedAt: now, error: v.error ?? null, ...v }
			})
			.run();
	try {
		const page = await safeGet(url, {
			maxBytes: PAGE_MAX,
			truncate: true,
			accept: 'text/html,application/xhtml+xml'
		});
		// A link straight to an image is its own preview.
		let image = page.type.startsWith('image/')
			? await safeGet(url, { maxBytes: IMAGE_MAX, accept: 'image/*' })
			: null;
		if (!image) {
			const src = findPreviewImage(new TextDecoder().decode(page.bytes), page.url);
			if (!src) return save({ imageRef: null, status: 'none' });
			image = await safeGet(src, { maxBytes: IMAGE_MAX, accept: 'image/*' });
		}
		const kind = sniffImage(image.bytes);
		if (!kind || kind.ext === 'heic') return save({ imageRef: null, status: 'none' });
		await mkdir(previewDir(), { recursive: true });
		const ref = `${fileBase(url)}.${kind.ext}`;
		await Bun.write(join(previewDir(), ref), image.bytes);
		save({ imageRef: ref, status: 'ok' });
	} catch (err) {
		save({
			imageRef: null,
			status: 'error',
			error: err instanceof Error ? err.message : String(err)
		});
	}
}

const pending = new Set<string>();
const queue: string[] = [];
let running = 0;

function pump() {
	while (running < 3 && queue.length) {
		const url = queue.shift()!;
		running++;
		fetchPreview(url).finally(() => {
			running--;
			pending.delete(url);
			pump();
		});
	}
}

/** Fetch in the background (deduplicated, 3 at a time). */
export function queuePreview(url: string) {
	if (pending.has(url)) return;
	pending.add(url);
	queue.push(url);
	pump();
}

/**
 * Preview image paths (/previews/<file>) for these links; links never tried (or due a retry) are
 * queued, so a later page view shows them.
 */
export function previewsFor(urls: string[]): Map<string, string> {
	const unique = [...new Set(urls.filter(Boolean))];
	if (!unique.length) return new Map();
	const rows = db().select().from(linkPreviews).where(inArray(linkPreviews.url, unique)).all();
	const byUrl = new Map(rows.map((r) => [r.url, r]));
	const now = Date.now();
	const out = new Map<string, string>();
	for (const url of unique) {
		const row = byUrl.get(url);
		if (row?.status === 'ok' && row.imageRef) out.set(url, `/previews/${row.imageRef}`);
		else if (!row || now - row.fetchedAt.getTime() > RETRY_MS[row.status as 'none' | 'error'])
			queuePreview(url);
	}
	return out;
}

/** Admin: forget a link's preview and fetch it again. */
export async function refreshPreview(url: string) {
	const row = db().select().from(linkPreviews).where(eq(linkPreviews.url, url)).get();
	if (row?.imageRef) await rm(join(previewDir(), row.imageRef), { force: true });
	db().delete(linkPreviews).where(eq(linkPreviews.url, url)).run();
	queuePreview(url);
}
