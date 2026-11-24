import { formatDate, formatTime, paragraphs } from '$lib/format';
import { refundDeadline } from '$lib/refund';
import type { EventRow } from './events';

// Plain, table-based HTML that survives mail clients (inline styles, no SVG, no web fonts), plus a
// text version of every mail. Brand: black on white, one orange accent.

const BRAND = '#ff4929';
const INK = '#121212';

const esc = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);

export interface Rendered {
	subject: string;
	html: string;
	text: string;
}

interface Block {
	/** Paragraph text (escaped here). */
	p?: string;
	/** Key/value detail rows. */
	details?: [string, string, string?][];
	button?: { label: string; href: string };
	/** Small print. */
	small?: string;
}

function layout(origin: string, heading: string, blocks: Block[], footer: string): string {
	const body = blocks
		.map((b) => {
			if (b.p)
				return `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${INK}">${esc(b.p)}</p>`;
			if (b.details)
				return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;width:100%;border:2px solid ${INK};border-radius:12px">${b.details
					.map(
						([k, v, href], i) =>
							`<tr><td style="padding:10px 14px;${i ? `border-top:1px dashed ${INK};` : ''}font-size:13px;color:#666;width:90px;vertical-align:top">${esc(k)}</td><td style="padding:10px 14px;${i ? `border-top:1px dashed ${INK};` : ''}font-size:15px;color:${INK};font-weight:600">${href ? `<a href="${esc(href)}" style="color:${INK}">${esc(v)}</a>` : esc(v)}</td></tr>`
					)
					.join('')}</table>`;
			if (b.button)
				return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px"><tr><td style="background:${INK};border-radius:999px"><a href="${esc(b.button.href)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none">${esc(b.button.label)}</a></td></tr></table>`;
			if (b.small)
				return `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#666">${esc(b.small)}</p>`;
			return '';
		})
		.join('');
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:2px solid ${INK};border-radius:20px">
<tr><td style="padding:24px 28px 8px"><a href="${esc(origin)}"><img src="${esc(origin)}/brand/ourbusan-vibe-wordmark-email.png" width="160" height="44" alt="OurBusan.vibe" style="display:block;border:0"></a></td></tr>
<tr><td style="padding:12px 28px 0"><div style="height:6px;width:56px;background:${BRAND};border-radius:3px"></div></td></tr>
<tr><td style="padding:16px 28px 12px"><h1 style="margin:0 0 18px;font-size:26px;line-height:1.2;color:${INK}">${esc(heading)}</h1>${body}</td></tr>
</table>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#777">${footer}</p>
</td></tr></table></body></html>`;
}

function plain(heading: string, blocks: Block[], footer: string): string {
	const lines = [heading, ''];
	for (const b of blocks) {
		if (b.p) lines.push(b.p, '');
		if (b.details) {
			for (const [k, v, href] of b.details) lines.push(`${k}: ${v}${href ? ` (${href})` : ''}`);
			lines.push('');
		}
		if (b.button) lines.push(`${b.button.label}: ${b.button.href}`, '');
		if (b.small) lines.push(b.small, '');
	}
	lines.push('--', footer.replace(/<[^>]+>/g, ''));
	return lines.join('\n');
}

function render(
	origin: string,
	subject: string,
	heading: string,
	blocks: Block[],
	footer = 'OurBusan.vibe · Busan, Korea. You get this email because you signed up on our site.'
): Rendered {
	return {
		subject,
		html: layout(origin, heading, blocks, esc(footer)),
		text: plain(heading, blocks, footer)
	};
}

function eventDetails(origin: string, e: EventRow): Block {
	const rows: [string, string, string?][] = [['Event', e.name, `${origin}/events/${e.slug}`]];
	rows.push([
		'When',
		`${formatDate(e.startsAt)}${e.startsAt ? `, ${formatTime(e.startsAt)}` : ''}${e.endsAt ? ` – ${formatTime(e.endsAt)}` : ''}`
	]);
	if (e.venue) rows.push(['Where', e.venue, e.venueUrl ?? undefined]);
	if (e.priceNote) rows.push(['Price', e.priceNote]);
	return { details: rows };
}

const at = (d: Date) => `${formatTime(d)} on ${formatDate(d)}`;

/** Step 1: confirm the address (also the link to continue on any device). */
export function confirmMail(
	origin: string,
	e: EventRow,
	o: { name: string; link: string; holdUntil: Date | null; waitlist: boolean }
): Rendered {
	return render(origin, `Confirm your email for ${e.name}`, `Hi ${o.name}, confirm your email`, [
		{
			p: o.waitlist
				? `You're on the waitlist for ${e.name}. Confirm your email so we can reach you when a seat opens up.`
				: `Tap the button to confirm your email and keep your seat at ${e.name}.${o.holdUntil ? ` We hold it for you until ${at(o.holdUntil)}.` : ''}`
		},
		{ button: { label: 'Confirm my email', href: o.link } },
		eventDetails(origin, e),
		{
			small:
				'The button also opens your signup on any device, so you can finish the remaining questions there.'
		},
		{ small: "Didn't sign up? Ignore this email and the seat is released." }
	]);
}

/** Someone entered an address that already has a signup: the link to continue it. */
export function resumeMail(
	origin: string,
	e: EventRow,
	o: { name: string; link: string }
): Rendered {
	return render(origin, `Your signup for ${e.name}`, `Hi ${o.name}, here's your signup`, [
		{
			p: `Someone (hopefully you) started signing up for ${e.name} with this email, which already has a signup. Use the button to open it.`
		},
		{ button: { label: 'Open my signup', href: o.link } },
		{ small: 'Not you? Ignore this email; nothing changes without the link.' }
	]);
}

/** Every step done (and email confirmed). */
export function doneMail(
	origin: string,
	e: EventRow,
	o: { name: string; link: string; waitlist: boolean; depositPending: boolean }
): Rendered {
	if (o.waitlist)
		return render(
			origin,
			`You're on the waitlist: ${e.name}`,
			`You're on the waitlist, ${o.name}`,
			[
				{ p: `${e.name} is full right now. We'll email you as soon as a seat opens up.` },
				eventDetails(origin, e),
				{ button: { label: 'View my signup', href: o.link } }
			]
		);
	const blocks: Block[] = [
		{ p: `Your seat at ${e.name} is confirmed. We can't wait to see what you build.` },
		eventDetails(origin, e)
	];
	if (o.depositPending)
		blocks.push({
			p: "We'll check your deposit and mark it as received; no need to do anything else."
		});
	if (e.startsAt)
		blocks.push({
			button: { label: 'Add to calendar', href: `${origin}/events/${e.slug}/calendar.ics` }
		});
	const refundBy = e.depositAmount === null ? null : refundDeadline(e.startsAt, e.refundDays);
	blocks.push({
		small: `Can't make it after all? Cancel your signup (one tap), so someone on the waitlist gets your seat${refundBy ? `; cancel by ${at(refundBy)} and you get your deposit back` : ''}: ${o.link}`
	});
	return render(origin, `You're in: ${e.name}`, `You're in, ${o.name}!`, blocks);
}

/** An admin moved them off the waitlist. */
export function promotedMail(
	origin: string,
	e: EventRow,
	o: { name: string; link: string; depositDue: boolean; holdUntil: Date | null }
): Rendered {
	return render(origin, `A seat opened up: ${e.name}`, `Good news, ${o.name}: a seat opened up`, [
		{
			p: o.depositDue
				? `You're off the waitlist for ${e.name}. To keep the seat, send the deposit${o.holdUntil ? ` by ${at(o.holdUntil)}` : ''}.`
				: `You're off the waitlist: your seat at ${e.name} is confirmed.`
		},
		{ button: { label: o.depositDue ? 'Pay the deposit' : 'View my signup', href: o.link } },
		eventDetails(origin, e)
	]);
}

/** An admin marked the deposit as received. */
export function paidMail(origin: string, e: EventRow, o: { name: string; link: string }): Rendered {
	return render(origin, `Payment received: ${e.name}`, `Thanks, ${o.name}, we got your payment`, [
		{ p: `Your deposit for ${e.name} is in and your seat is confirmed.` },
		eventDetails(origin, e),
		{ button: { label: 'View my signup', href: o.link } }
	]);
}

/** Admin announcement of a new event to the subscriber list. */
export function announceMail(origin: string, e: EventRow, unsubscribe: string): Rendered {
	const intro = paragraphs(e.description)[0];
	const r = render(
		origin,
		`New event: ${e.name}`,
		e.name,
		[
			...(e.tagline ? [{ p: e.tagline }] : []),
			eventDetails(origin, e),
			...(intro ? [{ p: intro.length > 400 ? `${intro.slice(0, 400).trimEnd()}…` : intro }] : []),
			{ button: { label: 'Save my seat', href: `${origin}/events/${e.slug}/signup` } }
		],
		'OurBusan.vibe · Busan, Korea. You get this because you asked to hear about new events.'
	);
	const link = `<a href="${esc(unsubscribe)}" style="color:#777">Unsubscribe</a>`;
	return {
		...r,
		html: r.html.replace(
			'asked to hear about new events.</p>',
			`asked to hear about new events. ${link}</p>`
		),
		text: `${r.text}\nUnsubscribe: ${unsubscribe}`
	};
}

/** What happens to a deposit on cancellation: due back, too late, no rule (ask), or nothing paid. */
export type Refund = 'due' | 'late' | 'ask' | null;

const won = (n: number | null) => (n === null ? 'deposit' : `₩${n.toLocaleString('en-US')}`);

/** The person cancelled. */
export function cancelledMail(
	origin: string,
	e: EventRow,
	o: { name: string; link: string; refund: Refund; contact: string | null }
): Rendered {
	return render(origin, `Cancelled: ${e.name}`, `Your signup is cancelled, ${o.name}`, [
		{
			p: `You're no longer signed up for ${e.name}, and your seat went back to the pool. Thanks for letting us know.`
		},
		...(o.refund === 'due'
			? [
					{
						p: o.contact
							? `You get your ${won(e.depositAmount)} deposit back: email ${o.contact} to claim it (include your bank details).`
							: `You get your ${won(e.depositAmount)} deposit back; we'll get in touch.`
					}
				]
			: o.refund === 'late'
				? [
						{
							p: `You cancelled after the refund deadline (${e.refundDays} days before the event), so the deposit isn't refunded.`
						}
					]
				: o.refund === 'ask'
					? [
							{
								p: o.contact
									? `About your deposit: email ${o.contact}.`
									: "About your deposit: we'll get in touch to sort it out."
							}
						]
					: []),
		{ p: 'Changed your mind?' },
		{ button: { label: 'Sign up again', href: o.link } }
	]);
}

/** To the organisers: someone cancelled. */
export function organiserCancelledMail(
	origin: string,
	e: EventRow,
	o: { name: string; email: string; refund: Refund; waitlist: string[]; adminUrl: string }
): Rendered {
	return render(
		origin,
		`Cancellation: ${o.name} · ${e.name}`,
		`${o.name} cancelled`,
		[
			{ p: `${o.name} (${o.email}) cancelled their signup for ${e.name}.` },
			...(o.refund === 'due'
				? [
						{
							p: `Refund due: they cancelled in time. Send back the ${won(e.depositAmount)} deposit, then mark it refunded in the admin.`
						}
					]
				: o.refund === 'late'
					? [{ p: 'They had paid, but cancelled after the refund deadline: no refund.' }]
					: o.refund === 'ask'
						? [
								{
									p: 'They had paid or sent a deposit (no refund rule set): decide about the refund.'
								}
							]
						: []),
			...(o.waitlist.length
				? [
						{
							p: `On the waitlist: ${o.waitlist.join(', ')}. Give one of them the seat in the admin.`
						}
					]
				: []),
			{ button: { label: 'Open the signups', href: o.adminUrl } }
		],
		'OurBusan.vibe admin notification.'
	);
}
