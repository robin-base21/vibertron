import type { VotingPhase } from 'common';
import type { LiveEvent } from './live.svelte';

export interface FixtureOptions {
	/** Pad to N teams. */
	teams?: number;
	/** Voting phase to preview (live/ended only). */
	voting?: VotingPhase;
	/** Results: force a tie for the win. */
	draw?: boolean;
}

const TICK_MS = 4000;

/**
 * Dev preview: seed fixture data, then simulate traffic every few seconds. Without voting: messages and
 * newly named projects. Group round: ballots come in and the round closes into the pitch round. Pitch
 * round: ballots come in.
 */
export function startFixture(
	live: LiveEvent,
	status: 'open' | 'live' | 'ended',
	opts: FixtureOptions = {}
): () => void {
	let timer: ReturnType<typeof setInterval> | undefined;
	let stopped = false;
	import('./fixtures').then(({ fixtureSnapshot, fixtureTeams, fixtureVoting }) => {
		if (stopped) return;
		const phase = opts.voting ?? 'none';
		const snap = fixtureSnapshot(status, Date.now(), phase, opts.draw);
		for (let i = snap.teams.length; status !== 'open' && i < (opts.teams ?? 0); i++) {
			snap.teams.push({
				...fixtureTeams[i % fixtureTeams.length]!,
				id: `team_x${i}`,
				name: `Team ${i + 1}`,
				codename: `Squad ${i + 1}`,
				members: []
			});
		}
		const allProjects = snap.projects;
		if (phase === 'none') snap.projects = allProjects.slice(0, Math.ceil(allProjects.length / 2));
		live.seed(snap);
		if (status === 'open') return;

		let n = 0;
		let progress = phase === 'pitch' ? 0 : 0.3;
		timer = setInterval(() => {
			const s = live.snapshot!;
			const votingPhase = s.event.votingPhase;
			if (votingPhase === 'group' || votingPhase === 'pitch') {
				progress = Math.min(1, progress + 0.12);
				const done = votingPhase === 'group' && progress >= 1;
				const next = done ? 'pitch' : votingPhase;
				live.handle({
					type: 'voting.updated',
					eventId: s.event.id,
					voting: fixtureVoting(next, s.teams, allProjects, done ? 0 : progress, opts.draw)
				});
				if (done) progress = 0;
				return;
			}
			if (votingPhase !== 'none' || status !== 'live') return;
			const missing = allProjects.find((p) => !s.projects.some((q) => q.id === p.id));
			if (missing && n % 2) live.handle({ type: 'project.updated', project: missing });
			const t = fixtureTeams[n % fixtureTeams.length]!;
			live.handle({
				type: 'message.created',
				message: {
					id: `fx_${n}`,
					eventId: 'evt_fixture',
					teamId: t.id,
					codename: t.codename ?? t.name,
					authorName: t.members[0]!.displayName,
					body: `Fixture message #${++n}: shipping the thing`,
					hidden: false,
					createdAt: Date.now()
				}
			});
		}, TICK_MS);
	});
	return () => {
		stopped = true;
		clearInterval(timer);
	};
}

export type FixtureStatus = 'open' | 'live' | 'ended';

/** `?fixture=open|live|ended[&teams=N][&voting=group|pitch|results][&draw]`; null outside dev. */
export function fixtureParams(
	url: URL,
	dev: boolean
): { fixture: FixtureStatus | null; fixtureOptions: FixtureOptions } {
	const f = url.searchParams.get('fixture');
	if (!dev || f === null) return { fixture: null, fixtureOptions: {} };
	const v = url.searchParams.get('voting');
	return {
		fixture: (['open', 'live', 'ended'] as const).find((s) => s === f) ?? 'live',
		fixtureOptions: {
			teams: Number(url.searchParams.get('teams')) || 0,
			voting: (['none', 'group', 'pitch', 'results'] as const).find((p) => p === v) ?? 'none',
			draw: url.searchParams.has('draw')
		}
	};
}
