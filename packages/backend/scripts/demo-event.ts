/*
Local test state through the running dev API (`bun run dev` first): an event on the fixture venue with
18 bot attendees (two friend pairs), launched in teams of 4 with codenames, messages and projects.
Uses the admin from .env.

  bun run demo                 launched, 8 h on the clock
  bun run demo --open          stops before launch: join on your phone, then Launch… in the UI
  bun run demo --minutes 30    other duration
*/
import { parseArgs } from 'node:util';
import { fixtureBlueprint } from '../../frontend/src/lib/blueprint/fixtures';

const { values: args } = parseArgs({
	options: { open: { type: 'boolean', default: false }, minutes: { type: 'string', default: '480' } },
	strict: true
});

const API = process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT ?? 3001}`;
const WEB = process.env.CORS_ORIGIN || 'http://localhost:3000';
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

const NAMES = ['Ada', 'Boris', 'Chen', 'Dana', 'Emil', 'Fatima', 'Gus', 'Hana', 'Ivo', 'Jade', 'Kofi', 'Lena', 'Milo', 'Nora', 'Omar', 'Pia', 'Quinn', 'Rosa'];
const CODENAMES = ['Null Pointers', 'Byte Club', 'Segfault Squad', 'Tabs > Spaces'];
const MESSAGES = ['Pizza has landed in the lounge', 'Anyone got a spare USB-C cable?', 'Demo at 18:00 sharp, good luck all'];
const PROJECTS = ['Standup Bot', 'Coffee Radar', 'Meeting Muter', 'Plant Pal', 'Git Haiku', 'Desk Booker', 'Lunch Roulette', 'Bug Bingo', 'Slide Doctor', 'Focus Fox'];

class Client {
	cookie = '';
	async req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await fetch(API + path, {
			method,
			headers: { ...(this.cookie && { cookie: this.cookie }), ...(body !== undefined && { 'content-type': 'application/json' }) },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const setCookie = res.headers.get('set-cookie');
		if (setCookie) this.cookie = setCookie.split(';')[0]!;
		const data: any = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${data.message ?? JSON.stringify(data)}`);
		return data as T;
	}
}

async function main() {
	if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Set ADMIN_EMAIL / ADMIN_PASSWORD in .env');
	await fetch(`${API}/api/health`).catch(() => {
		throw new Error(`Backend not reachable at ${API}. Start it with \`bun run dev\`.`);
	});

	const admin = new Client();
	await admin.req('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

	const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	const { event } = await admin.req('POST', '/api/events', { name: `Demo Night ${stamp}${args.open ? ' (open)' : ''}` });
	await admin.req('PATCH', `/api/events/${event.id}`, { status: 'open' });
	const { invite } = await admin.req('POST', `/api/events/${event.id}/invites`, {});

	// The fixture venue, with every station count confirmed so it can launch.
	const blueprint = structuredClone(fixtureBlueprint);
	blueprint.titleBlock.project = event.name;
	for (const s of blueprint.segments) s.stations.confirmed = true;
	await admin.req('PUT', `/api/events/${event.id}/blueprint`, { blueprint, version: 0 });

	const people: { name: string; c: Client; pid: string; friendCode: string }[] = [];
	for (const name of NAMES) {
		const c = new Client();
		const { code } = await admin.req('GET', `/api/invites/${invite.id}/code`);
		const { participant } = await c.req('POST', `/api/join/${invite.token}`, { code, displayName: name });
		people.push({ name, c, pid: participant.id, friendCode: participant.friendCode });
	}
	// Two friend pairs, so launch keeps them together.
	for (const [a, b] of [
		[0, 1],
		[2, 3]
	] as const) {
		const { pairing } = await people[a]!.c.req('POST', `/api/e/${event.slug}/pairings`, { friendCode: people[b]!.friendCode });
		await people[b]!.c.req('POST', `/api/pairings/${pairing.id}/accept`);
	}

	const links = [
		`Manager   ${WEB}/manage/${event.id}`,
		`TV        ${WEB}/e/${event.slug}/tv`,
		`Live      ${WEB}/e/${event.slug}/live`
	];

	if (args.open) {
		console.log(`\n${event.name}: open, ${people.length} bots joined (not launched).\n`);
		console.log([...links, `Join QR   ${WEB}/manage/${event.id}/qr/${invite.id}   (scan with your phone, then Launch… on the manager page)`].join('\n'));
		return;
	}

	const { teams } = await admin.req('POST', `/api/events/${event.id}/launch`, { teamSize: 4, durationMin: Number(args.minutes) });
	const byPid = new Map(people.map((p) => [p.pid, p]));
	// Codenames for most teams (one left unnamed), one message per named team, a project for every other person.
	for (const [i, team] of teams.entries()) {
		const first = byPid.get(team.members[0].participantId)!;
		if (i < CODENAMES.length) {
			await first.c.req('PATCH', `/api/teams/${team.id}`, { codename: CODENAMES[i] });
			if (i < MESSAGES.length) await first.c.req('POST', `/api/e/${event.slug}/messages`, { body: MESSAGES[i] });
		}
	}
	for (const [i, p] of people.entries()) {
		if (i % 2 === 0) await p.c.req('PUT', `/api/e/${event.slug}/project`, { name: PROJECTS[(i / 2) % PROJECTS.length] });
	}

	console.log(`\n${event.name}: live for ${args.minutes} min, ${teams.length} teams of ${people.length} bots.\n`);
	console.log([...links, `Rearrange ${WEB}/manage/${event.id}/teams`].join('\n'));
	console.log(`\nSign in as ${ADMIN_EMAIL}.`);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
