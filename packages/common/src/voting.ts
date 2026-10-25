import { z } from 'zod';
import { seededRandom } from './teams';

/*
Voting rounds, after the build:
  none    -> projects can be named/edited
  group   -> each team ranks its members' projects (not your own); the top project pitches
  pitch   -> every attendee ranks the pitches (not your own)
  results -> both rounds frozen, winner revealed
Scoring is Borda on a fixed scale: with N candidates in the round, position i (0-based) earns N - i.
*/

export const VotingPhase = z.enum(['none', 'group', 'pitch', 'results']);
export type VotingPhase = z.infer<typeof VotingPhase>;

export const VoteRound = z.enum(['group', 'pitch']);
export type VoteRound = z.infer<typeof VoteRound>;

/** The minimum a project needs for the voting rules. */
export interface VoteProject {
	id: string;
	participantId: string;
	teamId: string;
}

export interface TallyRow {
	projectId: string;
	points: number;
	/** Ballots that ranked this project first. */
	firsts: number;
	/** 1-based, strict (no shared ranks). */
	rank: number;
	/** True when points and firsts tie with a neighbour and the seeded draw decided the order. */
	tieBrokenByDraw: boolean;
}

/** Project ids a voter may rank: everything in `projects` except their own. */
export function candidatesFor(projects: VoteProject[], voterParticipantId: string): string[] {
	return projects.filter((p) => p.participantId !== voterParticipantId).map((p) => p.id);
}

/** Null when `ranking` is an exact permutation of `candidates`, else a reason. */
export function validateRanking(ranking: string[], candidates: string[]): string | null {
	if (candidates.length === 0) return 'Nothing to rank';
	if (ranking.length !== candidates.length) return `Rank all ${candidates.length} projects`;
	const allowed = new Set(candidates);
	const seen = new Set<string>();
	for (const id of ranking) {
		if (!allowed.has(id)) return 'Ranking contains a project you cannot vote for';
		if (seen.has(id)) return 'Ranking contains a project twice';
		seen.add(id);
	}
	return null;
}

/**
 * Members of a team who vote in the group round. A team with fewer than two projects does not vote:
 * its single project (if any) goes straight to the pitch round.
 */
export function groupEligibleVoters(memberIds: string[], teamProjects: VoteProject[]): string[] {
	if (teamProjects.length < 2) return [];
	return memberIds.filter((m) => candidatesFor(teamProjects, m).length > 0);
}

/** Voters of the pitch round: every attendee with at least one pitch that is not their own. */
export function pitchEligibleVoters(participantIds: string[], pitches: VoteProject[]): string[] {
	return participantIds.filter((p) => candidatesFor(pitches, p).length > 0);
}

/** Stable 32-bit seed from parts (FNV-1a), e.g. hashSeed(event.seed, teamId). */
export function hashSeed(...parts: (string | number | null | undefined)[]): number {
	let h = 0x811c9dc5;
	for (const ch of parts.map((p) => String(p ?? '')).join('|')) {
		h ^= ch.charCodeAt(0);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** Borda tally. Ties: more first places wins, then a seeded draw (reproducible for the same seed). */
export function tally(candidateIds: string[], ballots: string[][], seed: number): TallyRow[] {
	const n = candidateIds.length;
	const points = new Map(candidateIds.map((id) => [id, 0]));
	const firsts = new Map(candidateIds.map((id) => [id, 0]));
	for (const ballot of ballots) {
		ballot.forEach((id, i) => {
			if (!points.has(id)) return;
			points.set(id, points.get(id)! + n - i);
			if (i === 0) firsts.set(id, firsts.get(id)! + 1);
		});
	}
	const rand = seededRandom(seed);
	const draw = new Map([...candidateIds].sort().map((id) => [id, rand()]));
	const rows = candidateIds.map((projectId) => ({ projectId, points: points.get(projectId)!, firsts: firsts.get(projectId)! }));
	rows.sort((a, b) => b.points - a.points || b.firsts - a.firsts || draw.get(a.projectId)! - draw.get(b.projectId)!);
	const tied = (a?: { points: number; firsts: number }, b?: { points: number; firsts: number }) =>
		!!a && !!b && a.points === b.points && a.firsts === b.firsts;
	return rows.map((r, i) => ({ ...r, rank: i + 1, tieBrokenByDraw: tied(r, rows[i - 1]) || tied(r, rows[i + 1]) }));
}
