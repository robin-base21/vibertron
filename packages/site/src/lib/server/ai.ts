import type { z } from 'zod';
import { siteEnv } from './env';

// The only place the site talks to an AI model, server side only (admin actions). Two providers:
// - OpenRouter: chat completions for text (strict JSON schema) and for images (Gemini image models,
//   reference image sent as a message part).
// - PPQ: OpenAI-compatible chat for text (schema in the prompt; json_schema isn't documented there)
//   and its images API (generations, or edits with the reference image).
// Text answers are validated with zod either way.

const ENDPOINTS = {
	openrouter: { chat: 'https://openrouter.ai/api/v1/chat/completions' },
	ppq: {
		chat: 'https://api.ppq.ai/chat/completions',
		generate: 'https://api.ppq.ai/v1/images/generations',
		edit: 'https://api.ppq.ai/v1/images/edits'
	}
} as const;

export class AiError extends Error {}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface Message {
	role: 'system' | 'user';
	content: string | Part[];
}

export const aiConfigured = () => !!siteEnv.aiKey;
const providerName = () => (siteEnv.aiProvider === 'ppq' ? 'PPQ' : 'OpenRouter');

async function post(url: string, body: BodyInit, json: boolean, timeoutMs: number) {
	if (!siteEnv.aiKey)
		throw new AiError(
			`${siteEnv.aiProvider === 'ppq' ? 'PPQ_API_KEY' : 'OPENROUTER_API_KEY'} is not set`
		);
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${siteEnv.aiKey}`,
			...(json ? { 'Content-Type': 'application/json' } : {}),
			'X-Title': 'OurBusan.vibe'
		},
		body,
		signal: AbortSignal.timeout(timeoutMs)
	}).catch((err) => {
		throw new AiError(
			err instanceof Error && err.name === 'TimeoutError'
				? 'The AI took too long'
				: `Could not reach ${providerName()}`
		);
	});
	const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
		error?: { message?: string } | string;
	};
	if (!res.ok || data.error) {
		const msg = typeof data.error === 'string' ? data.error : data.error?.message;
		throw new AiError(`${providerName()}: ${msg ?? `status ${res.status}`}`);
	}
	return data;
}

type ChatMessage = { content?: unknown; images?: { image_url?: { url?: string } }[] };

async function chat(body: Record<string, unknown>, timeoutMs: number): Promise<ChatMessage> {
	const url = ENDPOINTS[siteEnv.aiProvider].chat;
	const data = (await post(url, JSON.stringify(body), true, timeoutMs)) as {
		choices?: { message?: ChatMessage }[];
	};
	const message = data.choices?.[0]?.message;
	if (!message) throw new AiError('The AI sent no answer');
	return message;
}

const textOf = (content: unknown) =>
	typeof content === 'string'
		? content
		: Array.isArray(content)
			? content.map((p: { text?: string }) => p.text ?? '').join('')
			: '';

function parseJson(text: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
	const candidate = (fenced ? fenced[1]! : text).trim();
	try {
		return JSON.parse(candidate);
	} catch {
		const start = candidate.indexOf('{');
		const end = candidate.lastIndexOf('}');
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(candidate.slice(start, end + 1));
			} catch {
				/* below */
			}
		}
		throw new AiError('The AI answer was not valid JSON');
	}
}

/** JSON answer matching `jsonSchema`, validated with zod. */
export async function aiJson<T extends z.ZodType>(o: {
	messages: Message[];
	name: string;
	jsonSchema: Record<string, unknown>;
	validate: T;
}): Promise<z.infer<T>> {
	const strict = siteEnv.aiProvider === 'openrouter';
	const messages = strict
		? o.messages
		: [
				...o.messages,
				{
					role: 'user' as const,
					content: `Answer with only a JSON object (no prose, no code fence) matching this JSON Schema:\n${JSON.stringify(o.jsonSchema)}`
				}
			];
	const message = await chat(
		{
			model: siteEnv.aiTextModel,
			messages,
			...(strict
				? {
						response_format: {
							type: 'json_schema',
							json_schema: { name: o.name, strict: true, schema: o.jsonSchema }
						}
					}
				: {})
		},
		90_000
	);
	const parsed = o.validate.safeParse(parseJson(textOf(message.content)));
	if (!parsed.success) throw new AiError('The AI answer did not fit the form; try again');
	return parsed.data;
}

const dataUrl = (bytes: Uint8Array, type: string) =>
	`data:${type};base64,${Buffer.from(bytes).toString('base64')}`;

/** One generated image (PNG/JPEG/WebP bytes). */
export async function aiImage(o: {
	prompt: string;
	reference?: { bytes: Uint8Array; type: string } | null;
	aspect: string;
}): Promise<{ bytes: Uint8Array; model: string }> {
	const model = siteEnv.aiImageModel;
	return siteEnv.aiProvider === 'ppq' ? ppqImage(o, model) : openrouterImage(o, model);
}

async function openrouterImage(
	o: Parameters<typeof aiImage>[0],
	model: string
): Promise<{ bytes: Uint8Array; model: string }> {
	const content: Part[] = [{ type: 'text', text: o.prompt }];
	if (o.reference)
		content.push({
			type: 'image_url',
			image_url: { url: dataUrl(o.reference.bytes, o.reference.type) }
		});
	const message = await chat(
		{
			model,
			messages: [{ role: 'user', content }],
			modalities: ['image', 'text'],
			image_config: { aspect_ratio: o.aspect, image_size: '2K' }
		},
		180_000
	);
	const url = message.images?.[0]?.image_url?.url ?? '';
	const m = /^data:image\/[\w.+-]+;base64,(.+)$/s.exec(url);
	if (!m) {
		const said = textOf(message.content).trim();
		throw new AiError(
			said ? `No image came back: ${said.slice(0, 200)}` : 'No image came back; try again'
		);
	}
	return { bytes: new Uint8Array(Buffer.from(m[1]!, 'base64')), model };
}

async function ppqImage(
	o: Parameters<typeof aiImage>[0],
	model: string
): Promise<{ bytes: Uint8Array; model: string }> {
	let data: Record<string, unknown>;
	if (o.reference) {
		const form = new FormData();
		const ext = o.reference.type.split('/')[1] ?? 'png';
		form.append(
			'image',
			new Blob([o.reference.bytes as Uint8Array<ArrayBuffer>], { type: o.reference.type }),
			`reference.${ext}`
		);
		form.append('prompt', o.prompt);
		form.append('model', model);
		form.append('size', o.aspect);
		form.append('resolution', '2K');
		form.append('n', '1');
		form.append('response_format', 'b64_json');
		data = await post(ENDPOINTS.ppq.edit, form, false, 180_000);
	} else {
		data = await post(
			ENDPOINTS.ppq.generate,
			JSON.stringify({
				model,
				prompt: o.prompt,
				size: o.aspect,
				resolution: '2K',
				n: 1,
				response_format: 'b64_json'
			}),
			true,
			180_000
		);
	}
	const first = (data.data as { b64_json?: string; url?: string }[] | undefined)?.[0];
	if (first?.b64_json)
		return { bytes: new Uint8Array(Buffer.from(first.b64_json, 'base64')), model };
	// Otherwise a signed URL on PPQ's own host.
	if (first?.url && new URL(first.url).hostname === 'api.ppq.ai') {
		const res = await fetch(first.url, { signal: AbortSignal.timeout(60_000) });
		if (res.ok) return { bytes: new Uint8Array(await res.arrayBuffer()), model };
	}
	throw new AiError('No image came back; try again');
}
