import { stationIds, type Blueprint } from './blueprint';

export interface AssignmentInput {
	participantIds: string[];
	/** Accepted pairings; participants linked (transitively) end up on the same team. */
	pairs: [string, string][];
	teamSize: number;
	blueprint: Blueprint;
	seed: number;
}

export interface AssignedTeam {
	index: number;
	name: string;
	segmentId: string;
	memberIds: string[];
	/** Same order as memberIds. */
	stationIds: string[];
}

export type AssignmentResult =
	| { ok: true; teams: AssignedTeam[] }
	| { ok: false; error: 'capacity'; needed: number; available: number; message: string }
	| { ok: false; error: 'invalid'; message: string };

/** mulberry32 */
export function seededRandom(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function shuffle<T>(items: T[], rand: () => number): T[] {
	const a = [...items];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[a[i], a[j]] = [a[j]!, a[i]!];
	}
	return a;
}

/** Union-find over pairings. Returns groups (each a list of participant ids). */
export function pairGroups(participantIds: string[], pairs: [string, string][]): string[][] {
	const parent = new Map(participantIds.map((id) => [id, id]));
	const find = (x: string): string => {
		let r = x;
		while (parent.get(r) !== r) r = parent.get(r)!;
		parent.set(x, r);
		return r;
	};
	for (const [a, b] of pairs) {
		if (!parent.has(a) || !parent.has(b)) continue;
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent.set(ra, rb);
	}
	const groups = new Map<string, string[]>();
	for (const id of participantIds) {
		const r = find(id);
		groups.set(r, [...(groups.get(r) ?? []), id]);
	}
	return [...groups.values()];
}

/** Team sizes for n people: ceil(n / teamSize) teams, balanced to within 1. */
export function teamSizes(n: number, teamSize: number): number[] {
	if (n === 0) return [];
	const count = Math.ceil(n / teamSize);
	const base = Math.floor(n / count);
	const extra = n % count;
	return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

export function assignTeams(input: AssignmentInput): AssignmentResult {
	const { participantIds, teamSize, blueprint, seed } = input;
	if (!Number.isInteger(teamSize) || teamSize < 1) return { ok: false, error: 'invalid', message: 'Team size must be at least 1' };
	if (participantIds.length === 0) return { ok: false, error: 'invalid', message: 'No participants' };

	const segments = blueprint.segments.filter((s) => s.stations.count > 0);
	if (segments.some((s) => !s.stations.confirmed) || blueprint.segments.some((s) => !s.stations.confirmed)) {
		return { ok: false, error: 'invalid', message: 'All segment station counts must be confirmed' };
	}
	const available = segments.reduce((sum, s) => sum + s.stations.count, 0);
	if (available < participantIds.length) {
		return {
			ok: false,
			error: 'capacity',
			needed: participantIds.length,
			available,
			message: `Need ${participantIds.length} stations, only ${available} available`
		};
	}

	const rand = seededRandom(seed);
	const groups = pairGroups(participantIds, input.pairs);
	if (groups.some((g) => g.length > teamSize)) {
		return { ok: false, error: 'invalid', message: 'A friend group is larger than the team size' };
	}

	// First-fit decreasing into balanced team slots. Shuffle first so ties are random.
	const sizes = teamSizes(participantIds.length, teamSize);
	const teams: string[][] = sizes.map(() => []);
	const sortedGroups = shuffle(groups, rand).sort((a, b) => b.length - a.length);
	const order = shuffle(
		sizes.map((_, i) => i),
		rand
	);
	for (const g of sortedGroups) {
		// Prefer the team with the most free room so groups spread out.
		let best = -1;
		let bestFree = -1;
		for (const t of order) {
			const free = sizes[t]! - teams[t]!.length;
			if (free >= g.length && free > bestFree) {
				best = t;
				bestFree = free;
			}
		}
		if (best === -1) {
			// Balanced sizes can't fit this group exactly; fall back to any team with room under teamSize.
			best = order.find((t) => teamSize - teams[t]!.length >= g.length) ?? -1;
			if (best === -1) return { ok: false, error: 'invalid', message: 'Could not fit friend groups into teams' };
		}
		teams[best]!.push(...g);
	}
	const filled = teams.filter((t) => t.length > 0);

	// Place teams into segments (a team never spans segments): largest teams first, best fit.
	const free = new Map(segments.map((s) => [s.id, stationIds(s)]));
	const placement: { members: string[]; segmentId: string; stations: string[] }[] = [];
	const byLargest = filled.map((m, i) => ({ m, i })).sort((a, b) => b.m.length - a.m.length);
	for (const { m } of byLargest) {
		let segId: string | undefined;
		let leftover = Infinity;
		for (const s of segments) {
			const left = free.get(s.id)!.length - m.length;
			if (left >= 0 && left < leftover) {
				segId = s.id;
				leftover = left;
			}
		}
		if (!segId) {
			const largestSegment = Math.max(...segments.map((s) => free.get(s.id)!.length));
			return {
				ok: false,
				error: 'capacity',
				needed: m.length,
				available: largestSegment,
				message: `A team of ${m.length} does not fit in any single segment`
			};
		}
		const stations = free.get(segId)!.splice(0, m.length);
		placement.push({ members: shuffle(m, rand), segmentId: segId, stations });
	}

	// Stable naming: order by segment order in the blueprint, then station.
	const segOrder = new Map(segments.map((s, i) => [s.id, i]));
	placement.sort((a, b) => segOrder.get(a.segmentId)! - segOrder.get(b.segmentId)! || a.stations[0]!.localeCompare(b.stations[0]!));
	return {
		ok: true,
		teams: placement.map((p, i) => ({
			index: i,
			name: `Team ${i + 1}`,
			segmentId: p.segmentId,
			memberIds: p.members,
			stationIds: p.stations
		}))
	};
}
