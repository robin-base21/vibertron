/*
Dev only: posts test messages to a live event as its attendees, so the TV message bubbles can be
checked. Opens a fresh session for each attendee on a team with a codename (straight in the local
dev DB, since bots have no password), then posts through the running API like a phone would.

  bun run demo:chat <slug>                 12 messages, one every 5 s
  bun run demo:chat <slug> --count 30 --every 3
*/
import { parseArgs } from 'node:util';
import { and, eq, isNotNull } from 'drizzle-orm';
import { createSession } from '../src/auth/session';
import { openDb } from '../src/db';
import { events, participants, teamMembers, teams, users } from '../src/db/schema';
import { loadEnv } from '../src/env';

const { values: args, positionals } = parseArgs({
	options: { count: { type: 'string', default: '12' }, every: { type: 'string', default: '5' } },
	allowPositionals: true,
	strict: true
});

const LINES = [
	'Pizza has landed in the lounge 🍕',
	'Anyone got a spare USB-C cable?',
	'Demo at 18:00 sharp, good luck all',
	'Who broke the wifi',
	'We just shipped dark mode. To a CLI.',
	'Coffee machine in the kitchen is back up',
	'Looking for someone who knows CSS grid, will pay in snacks',
	'Our AI agent just opened a PR against itself',
	'Reminder: name your project on your phone before voting',
	'It works on my machine ™',
	'Hall B is freezing, bring a hoodie',
	'Can the TV please stop showing our failed deploy'
];

const env = loadEnv();
const API = process.env.PUBLIC_API_URL || `http://localhost:${env.port}`;
const slug = positionals[0];
if (!slug) throw new Error('Usage: bun run demo:chat <event slug>');

const db = openDb(env.databasePath);
const event = db.select().from(events).where(eq(events.slug, slug)).get();
if (!event) throw new Error(`No event /${slug}`);
if (event.status !== 'live') throw new Error(`/${slug} is ${event.status}; messages only open while live`);

// One poster per named team (posting needs a codename), more if a team has several members.
const posters = db
	.select({ userId: users.id, name: users.displayName, codename: teams.codename })
	.from(teamMembers)
	.innerJoin(teams, eq(teams.id, teamMembers.teamId))
	.innerJoin(participants, eq(participants.id, teamMembers.participantId))
	.innerJoin(users, eq(users.id, participants.userId))
	.where(and(eq(teams.eventId, event.id), isNotNull(teams.codename)))
	.all()
	.map((p) => ({ ...p, cookie: createSession(db, p.userId, false).split(';')[0]! }));
if (posters.length === 0) throw new Error('No team has a codename yet, so nobody can post');

const count = Number(args.count);
const everyMs = Number(args.every) * 1000;
console.log(`Posting ${count} messages to /${slug}, one every ${args.every} s, from ${posters.length} attendees.`);
for (let i = 0; i < count; i++) {
	if (i > 0) await Bun.sleep(everyMs);
	// Round-robin keeps each attendee well under the per-person rate limit.
	const p = posters[i % posters.length]!;
	const body = LINES[i % LINES.length]!;
	const res = await fetch(`${API}/api/e/${slug}/messages`, {
		method: 'POST',
		headers: { cookie: p.cookie, 'content-type': 'application/json' },
		body: JSON.stringify({ body })
	});
	console.log(res.ok ? `${p.codename} · ${p.name}: ${body}` : `skipped (${res.status}): ${((await res.json()) as { message: string }).message}`);
}
