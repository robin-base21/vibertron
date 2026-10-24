import { stationIds, type Blueprint, type LiveSnapshotDTO, type MessageDTO, type TeamDTO } from 'common';

// Dev-only fixtures (`?fixture` on the editor, TV and live pages while running `vite dev`).

export const fixtureBlueprint: Blueprint = {
	schemaVersion: 1,
	canvas: { w: 1000, h: 625 },
	walls: [],
	outlines: [
		{ id: 'o1', kind: 'wall', closed: true, points: [[40, 40], [960, 40], [960, 585], [40, 585]] },
		{ id: 'o2', kind: 'wall', closed: false, points: [[520, 40], [520, 250]] },
		{ id: 'o3', kind: 'wall', closed: false, points: [[520, 330], [520, 585]] },
		{ id: 'o4', kind: 'room', closed: true, points: [[60, 470], [180, 470], [180, 570], [60, 570]] }
	],
	segments: [
		{
			id: 'seg_hall_a',
			name: 'Hall A',
			shape: 'rect',
			points: [[70, 70], [490, 300]],
			labelPos: [280, 185],
			stations: { count: 16, layout: 'grid', confirmed: true }
		},
		{
			id: 'seg_hall_b',
			name: 'Hall B',
			shape: 'rect',
			points: [[70, 330], [490, 450]],
			labelPos: [280, 390],
			stations: { count: 8, layout: 'row', confirmed: true }
		},
		{
			id: 'seg_lounge',
			name: 'Lounge',
			shape: 'polygon',
			points: [[550, 70], [930, 70], [930, 330], [740, 330], [740, 250], [550, 250]],
			labelPos: [740, 160],
			stations: { count: 10, layout: 'grid', confirmed: false },
			confidence: 0.45
		},
		{
			id: 'seg_lab',
			name: 'Maker Lab',
			shape: 'rect',
			points: [[550, 360], [740, 470]],
			labelPos: [645, 415],
			stations: { count: 6, layout: 'grid', confirmed: true },
			confidence: 0.82
		}
	],
	titleBlock: { project: 'Vibeathon #3', date: '2026-10-24', rev: 'B' }
};

const names = ['Ada', 'Linus', 'Grace', 'Ken', 'Barbara', 'Dennis', 'Margaret', 'Alan', 'Radia', 'Edsger', 'Frances', 'John'];

function team(i: number, segIdx: number, from: number, size: number, codename: string | null): TeamDTO {
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

/** `status`: pick the phase to preview. */
export function fixtureSnapshot(status: 'open' | 'live' | 'ended' = 'live', now = Date.now()): LiveSnapshotDTO {
	const live = status !== 'open';
	return {
		event: {
			id: 'evt_fixture',
			slug: 'fixture',
			name: 'Vibeathon #3',
			status,
			teamSize: 4,
			durationMin: 180,
			startedAt: live ? now - 60 * 60_000 : null,
			endsAt: status === 'live' ? now + 2 * 60 * 60_000 + 11 * 60_000 : status === 'ended' ? now - 1000 : null
		},
		blueprint: fixtureBlueprint,
		teams: live ? fixtureTeams : [],
		messages: live ? fixtureMessages(now) : [],
		participantCount: 18,
		serverTime: now
	};
}
