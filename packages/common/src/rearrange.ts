import { parseStationId, stationId, stationIds, type Blueprint } from './blueprint';

/*
Manager corrections after launch. Both moves only change which stations people sit at:
- member: one person joins another team, at the free station in that team's segment closest to it.
- swap: two people on different teams trade places (team and station), so it works in a full room.
- team: a whole team moves to another segment, onto the tightest run of free stations there.
A team never spans segments and never becomes empty. Colour, name and codename stay with the team.
*/

export interface PlacedTeam {
	id: string;
	segmentId: string;
	members: { participantId: string; stationId: string }[];
}

export type TeamMove =
	| { kind: 'member'; participantId: string; teamId: string }
	| { kind: 'swap'; participantId: string; withParticipantId: string }
	| { kind: 'team'; teamId: string; segmentId: string };

export type MoveResult =
	| { ok: true; teams: PlacedTeam[] }
	| { ok: false; message: string };

const indexOf = (stationId: string) => parseStationId(stationId)?.index ?? 0;

function freeIndices(blueprint: Blueprint, teams: PlacedTeam[], segmentId: string): number[] {
	const segment = blueprint.segments.find((s) => s.id === segmentId);
	if (!segment) return [];
	const taken = new Set(teams.flatMap((t) => t.members.map((m) => m.stationId)));
	return stationIds(segment)
		.filter((id) => !taken.has(id))
		.map(indexOf);
}

/** Applies a move and returns only the teams it changed (members sorted by station). */
export function applyTeamMove(blueprint: Blueprint, teams: PlacedTeam[], move: TeamMove): MoveResult {
	const segmentName = (id: string) => blueprint.segments.find((s) => s.id === id)?.name ?? id;
	const sorted = (t: PlacedTeam): PlacedTeam => ({
		...t,
		members: [...t.members].sort((a, b) => indexOf(a.stationId) - indexOf(b.stationId))
	});

	if (move.kind === 'member') {
		const from = teams.find((t) => t.members.some((m) => m.participantId === move.participantId));
		const to = teams.find((t) => t.id === move.teamId);
		if (!from) return { ok: false, message: 'That person is not on a team' };
		if (!to) return { ok: false, message: 'Team not found' };
		if (from.id === to.id) return { ok: true, teams: [] };
		if (from.members.length === 1) return { ok: false, message: 'A team needs at least one member' };

		const seat = seatInTeam(blueprint, teams, to.id);
		if (!seat) return { ok: false, message: `${segmentName(to.segmentId)} has no free station` };
		return {
			ok: true,
			teams: [
				sorted({ ...from, members: from.members.filter((m) => m.participantId !== move.participantId) }),
				sorted({ ...to, members: [...to.members, { participantId: move.participantId, stationId: seat }] })
			]
		};
	}

	if (move.kind === 'swap') {
		const teamOf = (pid: string) => teams.find((t) => t.members.some((m) => m.participantId === pid));
		const a = teamOf(move.participantId);
		const b = teamOf(move.withParticipantId);
		if (!a || !b) return { ok: false, message: 'That person is not on a team' };
		if (a.id === b.id) return { ok: true, teams: [] };
		const seat = (t: PlacedTeam, pid: string) => t.members.find((m) => m.participantId === pid)!.stationId;
		const [sa, sb] = [seat(a, move.participantId), seat(b, move.withParticipantId)];
		const swapIn = (t: PlacedTeam, out: string, inn: string, station: string): PlacedTeam =>
			sorted({ ...t, members: t.members.map((m) => (m.participantId === out ? { participantId: inn, stationId: station } : m)) });
		return { ok: true, teams: [swapIn(a, move.participantId, move.withParticipantId, sa), swapIn(b, move.withParticipantId, move.participantId, sb)] };
	}

	const team = teams.find((t) => t.id === move.teamId);
	if (!team) return { ok: false, message: 'Team not found' };
	if (!blueprint.segments.some((s) => s.id === move.segmentId)) return { ok: false, message: 'Area not found' };
	if (team.segmentId === move.segmentId) return { ok: true, teams: [] };

	const n = team.members.length;
	const free = freeIndices(blueprint, teams, move.segmentId);
	if (free.length < n) {
		return { ok: false, message: `${segmentName(move.segmentId)} has ${free.length} free station${free.length === 1 ? '' : 's'}, the team needs ${n}` };
	}
	// Window of n free stations with the smallest spread: a contiguous run when there is one.
	let start = 0;
	for (let k = 1; k + n - 1 < free.length; k++) {
		if (free[k + n - 1]! - free[k]! < free[start + n - 1]! - free[start]!) start = k;
	}
	const members = sorted(team).members.map((m, i) => ({
		participantId: m.participantId,
		stationId: stationId(move.segmentId, free[start + i]!)
	}));
	return { ok: true, teams: [{ ...team, segmentId: move.segmentId, members }] };
}

// ---------- Late arrivals (approved by a manager after launch) ----------

/** The free station in a team's segment closest to its members; null when the segment is full. */
export function seatInTeam(blueprint: Blueprint, teams: PlacedTeam[], teamId: string): string | null {
	const team = teams.find((t) => t.id === teamId);
	if (!team) return null;
	const free = freeIndices(blueprint, teams, team.segmentId);
	if (free.length === 0) return null;
	const own = team.members.map((m) => indexOf(m.stationId));
	const distance = (i: number) => (own.length ? Math.min(...own.map((o) => Math.abs(o - i))) : i);
	return stationId(team.segmentId, free.reduce((best, i) => (distance(i) < distance(best) ? i : best)));
}

/** A seat for a brand-new team: first free station of the segment with the most room. */
export function newTeamSeat(blueprint: Blueprint, teams: PlacedTeam[]): { segmentId: string; stationId: string } | null {
	let best: { segmentId: string; free: number[] } | null = null;
	for (const s of blueprint.segments) {
		const free = freeIndices(blueprint, teams, s.id);
		if (free.length && (!best || free.length > best.free.length)) best = { segmentId: s.id, free };
	}
	return best ? { segmentId: best.segmentId, stationId: stationId(best.segmentId, best.free[0]!) } : null;
}

/**
 * Team to suggest for a late arrival: a friend's team when it has room, else the smallest team with a
 * free seat in its area (earliest team on ties). null: no team has room, so suggest a new team.
 */
export function suggestTeam(blueprint: Blueprint, teams: (PlacedTeam & { position: number })[], friendIds: string[] = []): string | null {
	const roomy = teams.filter((t) => freeIndices(blueprint, teams, t.segmentId).length > 0);
	const friends = new Set(friendIds);
	const friendTeam = roomy.find((t) => t.members.some((m) => friends.has(m.participantId)));
	if (friendTeam) return friendTeam.id;
	const [smallest] = [...roomy].sort((a, b) => a.members.length - b.members.length || a.position - b.position);
	return smallest?.id ?? null;
}
