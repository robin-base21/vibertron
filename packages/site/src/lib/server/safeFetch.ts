import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Fetching URLs that people typed in (project links): only public http(s) hosts, no internal
// addresses (the server's own network, cloud metadata, localhost), redirects re-checked hop by hop,
// a timeout and a size cap.

export class FetchBlocked extends Error {}

function privateV4(ip: string): boolean {
	const [a, b] = ip.split('.').map(Number) as [number, number];
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		a >= 224
	);
}

export function isPrivateAddress(ip: string): boolean {
	if (isIP(ip) === 4) return privateV4(ip);
	const v6 = ip.toLowerCase();
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
	if (mapped) return privateV4(mapped[1]!);
	return (
		v6 === '::' ||
		v6 === '::1' ||
		v6.startsWith('fc') ||
		v6.startsWith('fd') ||
		v6.startsWith('fe8') ||
		v6.startsWith('fe9') ||
		v6.startsWith('fea') ||
		v6.startsWith('feb') ||
		v6.startsWith('ff')
	);
}

async function checkUrl(raw: string): Promise<URL> {
	const url = new URL(raw);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchBlocked('Not http(s)');
	if (url.port && url.port !== '80' && url.port !== '443') throw new FetchBlocked('Unusual port');
	if (url.username || url.password) throw new FetchBlocked('Credentials in URL');
	const host = url.hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
	if (!addresses.length || addresses.some(isPrivateAddress))
		throw new FetchBlocked('Internal address');
	return url;
}

const UA = 'Mozilla/5.0 (compatible; OurBusanVibePreview/1.0; +https://vibe.ourbusan.life)';

/** GET a public URL, following up to 4 redirects; the body is cut off at maxBytes. */
export async function safeGet(
	raw: string,
	o: {
		maxBytes: number;
		accept: string;
		timeoutMs?: number;
		/** Keep the first maxBytes instead of failing. */ truncate?: boolean;
	}
): Promise<{ url: URL; type: string; bytes: Uint8Array }> {
	let url = await checkUrl(raw);
	const signal = AbortSignal.timeout(o.timeoutMs ?? 8000);
	for (let hop = 0; hop < 5; hop++) {
		const res = await fetch(url, {
			redirect: 'manual',
			signal,
			headers: { 'User-Agent': UA, Accept: o.accept }
		});
		if (res.status >= 300 && res.status < 400) {
			const next = res.headers.get('location');
			await res.body?.cancel();
			if (!next) throw new Error(`Redirect without location (${res.status})`);
			url = await checkUrl(new URL(next, url).toString());
			continue;
		}
		if (!res.ok) {
			await res.body?.cancel();
			throw new Error(`HTTP ${res.status}`);
		}
		const length = Number(res.headers.get('content-length') ?? 0);
		if (length > o.maxBytes && !o.truncate) {
			await res.body?.cancel();
			throw new Error('Too large');
		}
		const chunks: Uint8Array[] = [];
		let size = 0;
		const reader = res.body!.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (size + value.length > o.maxBytes) {
				await reader.cancel();
				if (!o.truncate) throw new Error('Too large');
				chunks.push(value.subarray(0, o.maxBytes - size));
				size = o.maxBytes;
				break;
			}
			size += value.length;
			chunks.push(value);
		}
		const bytes = new Uint8Array(size);
		let at = 0;
		for (const c of chunks) {
			bytes.set(c, at);
			at += c.length;
		}
		return { url, type: res.headers.get('content-type') ?? '', bytes };
	}
	throw new Error('Too many redirects');
}
