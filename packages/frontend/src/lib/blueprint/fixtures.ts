import {
	candidatesFor,
	groupEligibleVoters,
	hashSeed,
	pitchEligibleVoters,
	seededRandom,
	stationIds,
	tally,
	type Blueprint,
	type LiveSnapshotDTO,
	type MessageDTO,
	type ProjectDTO,
	type TallyRow,
	type TeamDTO,
	type VotingPhase,
	type VotingStateDTO
} from 'common';

// Dev-only fixtures (`?fixture` on the editor, TV and live pages while running `vite dev`).

export const fixtureBlueprint: Blueprint = {
	schemaVersion: 1,
	canvas: { w: 1000, h: 625 },
	walls: [
		{ id: 'w1', a: [40, 40], b: [960, 40] },
		{ id: 'w2', a: [960, 40], b: [960, 585] },
		{ id: 'w3', a: [960, 585], b: [40, 585] },
		{ id: 'w4', a: [40, 585], b: [40, 40] },
		{ id: 'w5', a: [520, 40], b: [520, 250] },
		{ id: 'w6', a: [520, 330], b: [520, 585] },
		{ id: 'w7', a: [40, 450], b: [200, 450] },
		{ id: 'w8', a: [200, 450], b: [200, 520] }
	],
	outlines: [
		{
			id: 'r1',
			kind: 'room',
			closed: true,
			label: 'Kitchen',
			points: [
				[40, 450],
				[200, 450],
				[200, 585],
				[40, 585]
			]
		}
	],
	segments: [
		{
			id: 'seg_hall_a',
			name: 'Hall A',
			shape: 'rect',
			points: [
				[70, 70],
				[490, 300]
			],
			labelPos: [280, 185],
			stations: { count: 16, layout: 'grid', confirmed: true }
		},
		{
			id: 'seg_hall_b',
			name: 'Hall B',
			shape: 'rect',
			points: [
				[70, 330],
				[490, 450]
			],
			labelPos: [280, 390],
			stations: { count: 8, layout: 'row', confirmed: true }
		},
		{
			id: 'seg_lounge',
			name: 'Lounge',
			shape: 'polygon',
			points: [
				[550, 70],
				[930, 70],
				[930, 330],
				[740, 330],
				[740, 250],
				[550, 250]
			],
			labelPos: [740, 160],
			stations: { count: 10, layout: 'grid', confirmed: false },
			confidence: 0.45
		},
		{
			id: 'seg_lab',
			name: 'Maker Lab',
			shape: 'rect',
			points: [
				[550, 360],
				[740, 470]
			],
			labelPos: [645, 415],
			stations: { count: 6, layout: 'grid', confirmed: true },
			confidence: 0.82
		}
	],
	titleBlock: { project: 'Vibeathon #3', date: '2026-10-24', rev: 'B' }
};

const names = [
	'Ada',
	'Linus',
	'Grace',
	'Ken',
	'Barbara',
	'Dennis',
	'Margaret',
	'Alan',
	'Radia',
	'Edsger',
	'Frances',
	'John'
];

function team(
	i: number,
	segIdx: number,
	from: number,
	size: number,
	codename: string | null
): TeamDTO {
	const seg = fixtureBlueprint.segments[segIdx]!;
	const ids = stationIds(seg).slice(from, from + size);
	return {
		id: `team_${i}`,
		eventId: 'evt_fixture',
		name: `Team ${i}`,
		codename,
		segmentId: seg.id,
		members: ids.map((stationId, k) => ({
			participantId: `p_${i}_${k}`,
			displayName: names[(i * 3 + k) % names.length]!,
			stationId
		}))
	};
}

export const fixtureTeams: TeamDTO[] = [
	team(1, 0, 0, 4, 'Null Pointers'),
	team(2, 0, 4, 4, 'Byte Club'),
	team(3, 0, 8, 3, null),
	team(4, 1, 0, 4, 'Segfault Squad'),
	team(5, 3, 0, 3, 'Tabs > Spaces')
];

export function fixtureMessages(now = Date.now()): MessageDTO[] {
	const bodies = [
		'Coffee machine on level 2 is back online',
		'We need a second HDMI cable, anyone?',
		'Demo at 18:00 sharp, good luck all',
		'Pizza has landed in the lounge'
	];
	return bodies.map((body, i) => {
		const t = fixtureTeams[i % fixtureTeams.length]!;
		return {
			id: `msg_${i}`,
			eventId: 'evt_fixture',
			teamId: t.id,
			codename: t.codename ?? t.name,
			authorName: t.members[0]!.displayName,
			body,
			hidden: false,
			createdAt: now - (bodies.length - i) * 90_000
		};
	});
}

const projectNames = [
	['Pixel Pantry', 'Fridge photos in, recipes out'],
	['Standup Bot', 'Async standups that read like a story'],
	['Queue Tips', 'Know the wait before you queue'],
	['Rubber Duck AI', null],
	['Carbon Diff', 'CO2 cost of every pull request'],
	['Plant Pal', 'Your houseplants, on call'],
	['Meme Lint', 'Lints your memes for accessibility'],
	['Late Night Bus', 'Shared rides home after events'],
	['Haiku Commit', 'Commit messages in 5-7-5'],
	['Desk Radar', 'Find a free desk in one tap'],
	['Fork Lift', 'Revive abandoned open-source forks'],
	['Snack Overflow', 'Office snack voting'],
	['Ghost Writer', 'Release notes from your git log'],
	['Tiny Tutor', 'Five-minute lessons on anything']
];

/**
 * One project per member, except: team 3's last member hasn't named one, and only the first member of
 * team 5 has (so team 5 skips the group round and goes straight through).
 */
export function fixtureProjects(teams: TeamDTO[] = fixtureTeams): ProjectDTO[] {
	const out: ProjectDTO[] = [];
	for (const t of teams) {
		t.members.forEach((m, k) => {
			if ((t.id === 'team_3' && k === t.members.length - 1) || (t.id === 'team_5' && k > 0)) return;
			const [name, tagline] = projectNames[out.length % projectNames.length]!;
			out.push({
				id: `prj_${m.participantId}`,
				eventId: t.eventId,
				teamId: t.id,
				participantId: m.participantId,
				authorName: m.displayName,
				name: name!,
				tagline: tagline ?? null
			});
		});
	}
	return out;
}

/** A voter's ranking: their candidates in a seeded order. */
function fakeBallot(candidates: string[], voter: string): string[] {
	const rand = seededRandom(hashSeed('fixture', voter));
	return candidates
		.map((id) => ({ id, r: rand() }))
		.sort((a, b) => a.r - b.r)
		.map((x) => x.id);
}

/**
 * The voting state in `phase`, computed with the real rules from fake ballots. `progress` (0..1) is the
 * share of ballots cast in the current round, so a preview can tick it up. `draw`: force a tie for the
 * win so the results show the "decided by draw" note.
 */
export function fixtureVoting(
	phase: VotingPhase,
	teams: TeamDTO[] = fixtureTeams,
	projects: ProjectDTO[] = fixtureProjects(teams),
	progress = 0.3,
	draw = false
): VotingStateDTO {
	const after = (p: VotingPhase) =>
		['none', 'group', 'pitch', 'results'].indexOf(phase) >
		['none', 'group', 'pitch', 'results'].indexOf(p);
	const groupShare = phase === 'group' ? progress : after('group') ? 1 : 0;
	const groupResults: Record<string, TallyRow[]> = {};
	const pitches: ProjectDTO[] = [];
	const perTeam = teams.map((t, ti) => {
		const own = projects.filter((p) => p.teamId === t.id);
		const voters = groupEligibleVoters(
			t.members.map((m) => m.participantId),
			own
		);
		// earlier teams finish first, so a partial round shows done, partial and empty teams
		const cast = Math.min(
			voters.length,
			Math.max(0, Math.round(voters.length * (groupShare * teams.length - ti * 0.6)))
		);
		if (own.length === 1) pitches.push(own[0]!);
		else if (own.length > 1) {
			const ballots = voters.map((v) => fakeBallot(candidatesFor(own, v), v));
			groupResults[t.id] = tally(
				own.map((p) => p.id),
				ballots,
				hashSeed('fixture', t.id)
			);
			pitches.push(own.find((p) => p.id === groupResults[t.id]![0]!.projectId)!);
		}
		return { teamId: t.id, cast: phase === 'none' ? 0 : cast, eligible: voters.length };
	});
	const voting = perTeam.filter((t) => t.eligible > 0);
	const pitchVoters = pitchEligibleVoters(
		teams.flatMap((t) => t.members.map((m) => m.participantId)),
		pitches
	);
	const pitchCast = Math.round(
		pitchVoters.length * (phase === 'pitch' ? progress : phase === 'results' ? 1 : 0)
	);
	const pitchTally = tally(
		pitches.map((p) => p.id),
		pitchVoters.map((v) => fakeBallot(candidatesFor(pitches, v), v)),
		hashSeed('fixture', 'pitch')
	);
	if (draw && pitchTally.length > 1) {
		pitchTally[1] = {
			...pitchTally[1]!,
			points: pitchTally[0]!.points,
			firsts: pitchTally[0]!.firsts,
			tieBrokenByDraw: true
		};
		pitchTally[0] = { ...pitchTally[0]!, tieBrokenByDraw: true };
	}
	return {
		phase,
		group: {
			teamsDone: voting.filter((t) => t.cast >= t.eligible).length,
			teamsTotal: voting.length,
			perTeam
		},
		pitch: { cast: pitchCast, eligible: pitchVoters.length },
		pitches: after('group') ? pitches : [],
		results: phase === 'results' ? { group: groupResults, pitch: pitchTally } : undefined
	};
}

/** `status`: pick the phase to preview; `votingPhase` only applies once the event is live. */
export function fixtureSnapshot(
	status: 'open' | 'live' | 'ended' = 'live',
	now = Date.now(),
	votingPhase: VotingPhase = 'none',
	draw = false
): LiveSnapshotDTO {
	const live = status !== 'open';
	const phase = live ? votingPhase : 'none';
	const projects = live ? fixtureProjects() : [];
	return {
		event: {
			id: 'evt_fixture',
			slug: 'fixture',
			name: 'Vibeathon #3',
			status,
			teamSize: 4,
			durationMin: 180,
			startedAt: live ? now - 60 * 60_000 : null,
			endsAt:
				status === 'live'
					? now + 2 * 60 * 60_000 + 11 * 60_000
					: status === 'ended'
						? now - 1000
						: null,
			votingPhase: phase
		},
		blueprint: fixtureBlueprint,
		teams: live ? fixtureTeams : [],
		messages: live ? fixtureMessages(now) : [],
		participantCount: 18,
		projects,
		voting: fixtureVoting(phase, live ? fixtureTeams : [], projects, phase === 'pitch' ? 0 : 0.3, draw),
		serverTime: now
	};
}
