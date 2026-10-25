import type { LiveSnapshotDTO, ProjectDTO, TallyRow, TeamDTO, VotingStateDTO } from 'common';

// Pure view helpers for the voting panels on the TV and the /live page. Unit-tested.

/** Snapshot with a new voting state; the event's phase follows it (event.updated may arrive later). */
export function withVoting(snapshot: LiveSnapshotDTO, voting: VotingStateDTO): LiveSnapshotDTO {
	const event =
		snapshot.event.votingPhase === voting.phase
			? snapshot.event
			: { ...snapshot.event, votingPhase: voting.phase };
	return { ...snapshot, event, voting };
}

export function upsertProject(projects: ProjectDTO[], project: ProjectDTO): ProjectDTO[] {
	return projects.some((p) => p.id === project.id)
		? projects.map((p) => (p.id === project.id ? project : p))
		: [...projects, project];
}

/** Named projects per team id. */
export function projectCounts(projects: ProjectDTO[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const p of projects) counts.set(p.teamId, (counts.get(p.teamId) ?? 0) + 1);
	return counts;
}

export const teamLabel = (team: TeamDTO | undefined) =>
	team?.codename ?? team?.name ?? 'Unknown team';

export interface GroupRow {
	team: TeamDTO;
	cast: number;
	eligible: number;
	/** 'vote': the team ranks; 'through': its only project pitches; 'none': no project. */
	mode: 'vote' | 'through' | 'none';
	done: boolean;
}

/** One row per team in team order: voting teams with their ballot progress, the rest with why they skip. */
export function groupRows(
	voting: VotingStateDTO,
	teams: TeamDTO[],
	projects: ProjectDTO[]
): GroupRow[] {
	const progress = new Map(voting.group.perTeam.map((t) => [t.teamId, t]));
	const counts = projectCounts(projects);
	return teams.map((team) => {
		const p = progress.get(team.id);
		const eligible = p?.eligible ?? 0;
		const cast = Math.min(p?.cast ?? 0, eligible);
		const mode = eligible > 0 ? 'vote' : (counts.get(team.id) ?? 0) > 0 ? 'through' : 'none';
		return { team, cast, eligible, mode, done: mode !== 'vote' || cast >= eligible };
	});
}

export interface RankedProject extends TallyRow {
	project: ProjectDTO | undefined;
	team: TeamDTO | undefined;
}

/** The pitch tally joined with projects and teams, best first. Empty before the results phase. */
export function pitchRanking(
	voting: VotingStateDTO,
	teams: TeamDTO[],
	projects: ProjectDTO[]
): RankedProject[] {
	const rows = voting.results?.pitch ?? [];
	const byId = new Map([...projects, ...voting.pitches].map((p) => [p.id, p]));
	const teamById = new Map(teams.map((t) => [t.id, t]));
	return [...rows]
		.sort((a, b) => a.rank - b.rank)
		.map((r) => {
			const project = byId.get(r.projectId);
			return { ...r, project, team: project ? teamById.get(project.teamId) : undefined };
		});
}

/** True when the top two pitch rows were separated by the draw. */
export function winnerByDraw(ranking: RankedProject[]): boolean {
	return !!ranking[0]?.tieBrokenByDraw && !!ranking[1]?.tieBrokenByDraw;
}
