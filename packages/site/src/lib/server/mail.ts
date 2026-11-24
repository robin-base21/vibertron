import { and, eq, gt, ne } from 'drizzle-orm';
import { db } from './db';
import { emails } from './db/schema';
import { siteEnv } from './env';

// All site email goes through here: Resend's HTTP API when RESEND_API_KEY is set, otherwise the mail
// is only stored (and logged), so the admin "Emails" page shows what would have gone out.

export type MailKind =
	'confirm' | 'resume' | 'done' | 'promoted' | 'paid' | 'announce' | 'cancelled' | 'organiser';

export interface Mail {
	kind: MailKind;
	to: string;
	subject: string;
	html: string;
	text: string;
	eventId?: string | null;
	signupId?: string | null;
	headers?: Record<string, string>;
}

const API = 'https://api.resend.com';

function body(m: Mail) {
	return {
		from: siteEnv.mailFrom,
		to: [m.to],
		subject: m.subject,
		html: m.html,
		text: m.text,
		...(siteEnv.mailReplyTo ? { reply_to: siteEnv.mailReplyTo } : {}),
		...(m.headers ? { headers: m.headers } : {})
	};
}

function record(m: Mail, status: 'sent' | 'failed' | 'logged', providerId?: string, err?: string) {
	db()
		.insert(emails)
		.values({
			id: crypto.randomUUID(),
			kind: m.kind,
			to: m.to,
			subject: m.subject,
			html: m.html,
			text: m.text,
			eventId: m.eventId ?? null,
			signupId: m.signupId ?? null,
			status,
			providerId: providerId ?? null,
			error: err ?? null
		})
		.run();
}

async function post(path: string, payload: unknown): Promise<unknown> {
	const res = await fetch(API + path, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${siteEnv.resendKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(15_000)
	});
	const json = (await res.json().catch(() => ({}))) as { message?: string };
	if (!res.ok) throw new Error(json.message ?? `Resend answered ${res.status}`);
	return json;
}

/** Sends one email. Never throws: returns whether it went out (or was logged without a key). */
export async function sendMail(m: Mail): Promise<boolean> {
	if (!siteEnv.resendKey) {
		console.log(`[mail] (not sent, no RESEND_API_KEY) ${m.kind} → ${m.to}: ${m.subject}`);
		record(m, 'logged');
		return true;
	}
	try {
		const res = (await post('/emails', body(m))) as { id?: string };
		record(m, 'sent', res.id);
		return true;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[mail] ${m.kind} → ${m.to} failed: ${message}`);
		record(m, 'failed', undefined, message);
		return false;
	}
}

/** Sends many emails, 100 per Resend batch call. Returns how many went out. */
export async function sendMany(mails: Mail[]): Promise<{ sent: number; failed: number }> {
	if (!siteEnv.resendKey) {
		for (const m of mails) await sendMail(m);
		return { sent: mails.length, failed: 0 };
	}
	let sent = 0;
	let failed = 0;
	for (let i = 0; i < mails.length; i += 100) {
		const chunk = mails.slice(i, i + 100);
		try {
			const res = (await post('/emails/batch', chunk.map(body))) as { data?: { id: string }[] };
			chunk.forEach((m, j) => record(m, 'sent', res.data?.[j]?.id));
			sent += chunk.length;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[mail] batch of ${chunk.length} failed: ${message}`);
			for (const m of chunk) record(m, 'failed', undefined, message);
			failed += chunk.length;
		}
		// Resend allows a couple of requests per second.
		if (i + 100 < mails.length) await Bun.sleep(600);
	}
	return { sent, failed };
}

/** Was a mail of this kind already sent (or logged) to this signup, optionally since a time? */
export function alreadySent(signupId: string, kind: MailKind, since?: Date): boolean {
	return !!db()
		.select({ id: emails.id })
		.from(emails)
		.where(
			and(
				eq(emails.signupId, signupId),
				eq(emails.kind, kind),
				ne(emails.status, 'failed'),
				since ? gt(emails.createdAt, since) : undefined
			)
		)
		.get();
}

export const mailConfigured = () => !!siteEnv.resendKey;
