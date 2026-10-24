import type { z } from 'zod';

// The only place the backend talks to an LLM. OpenAI-compatible chat completions via OpenRouter.

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const AI_TIMEOUT_MS = 60_000;

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string | ContentPart[];
}

export interface OpenRouterConfig {
	apiKey: string;
	model: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
}

export interface StructuredRequest<T extends z.ZodType> {
	messages: ChatMessage[];
	schemaName: string;
	/** JSON Schema sent as response_format (strict). */
	jsonSchema: Record<string, unknown>;
	/** Validation always runs: not every model honours structured output. */
	validate: T;
}

export class AiError extends Error {}

export function imageDataUrl(bytes: Uint8Array, contentType: string): string {
	return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** Extract JSON from a reply that may be wrapped in a ``` fence or surrounded by prose. */
export function extractJson(text: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
	const candidate = (fenced ? fenced[1]! : text).trim();
	try {
		return JSON.parse(candidate);
	} catch {
		const start = candidate.indexOf('{');
		const end = candidate.lastIndexOf('}');
		if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
		throw new AiError('Reply is not valid JSON');
	}
}

async function complete(cfg: OpenRouterConfig, messages: ChatMessage[], schemaName: string, jsonSchema: Record<string, unknown>): Promise<string> {
	const res = await (cfg.fetch ?? fetch)(OPENROUTER_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${cfg.apiKey}`,
			'Content-Type': 'application/json',
			'X-Title': 'Vibertron'
		},
		body: JSON.stringify({
			model: cfg.model,
			messages,
			response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: jsonSchema } }
		}),
		signal: AbortSignal.timeout(cfg.timeoutMs ?? AI_TIMEOUT_MS)
	});
	if (!res.ok) throw new AiError(`OpenRouter responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[]; error?: { message?: string } };
	if (data.error) throw new AiError(`OpenRouter error: ${data.error.message ?? 'unknown'}`);
	const content = data.choices?.[0]?.message?.content;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) return content.map((p: { text?: string }) => p.text ?? '').join('');
	throw new AiError('OpenRouter reply has no content');
}

/**
 * Ask for structured JSON and validate it with zod. On invalid output, retries once with the
 * validation errors appended to the conversation. Throws AiError on failure.
 */
export async function structuredCompletion<T extends z.ZodType>(cfg: OpenRouterConfig, req: StructuredRequest<T>): Promise<z.infer<T>> {
	if (!cfg.apiKey) throw new AiError('OPENROUTER_API_KEY is not set');
	const messages = [...req.messages];
	let lastError = '';
	for (let attempt = 0; attempt < 2; attempt++) {
		const text = await complete(cfg, messages, req.schemaName, req.jsonSchema);
		let problem: string;
		try {
			const result = req.validate.safeParse(extractJson(text));
			if (result.success) return result.data;
			problem = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
		}
		lastError = problem;
		messages.push(
			{ role: 'assistant', content: text },
			{ role: 'user', content: `Your reply did not match the required JSON schema:\n${problem}\nReply again with only the corrected JSON.` }
		);
	}
	throw new AiError(`Invalid AI reply after retry: ${lastError}`);
}
