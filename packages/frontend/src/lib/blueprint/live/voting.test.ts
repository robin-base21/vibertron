/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { fixtureProjects, fixtureSnapshot, fixtureTeams, fixtureVoting } from '../fixtures';
import { groupRows, pitchRanking, projectCounts, upsertProject, winnerByDraw, withVoting } from './voting';

test('withVoting moves the event phase along with the voting state', () => {
	const snap = fixtureSnapshot('live', 0, 'group');
	const next = withVoting(snap, fixtureVoting('pitch'));
	expect(next.event.votingPhase).toBe('pitch');
	expect(next.voting.pitches.length).toBe(5);
	expect(snap.event.votingPhase).toBe('group');
	expect(withVoting(snap, snap.voting).event).toBe(snap.event);
});

test('upsertProject replaces by id or appends; projectCounts per team', () => {
	const projects = fixtureProjects();
	const renamed = upsertProject(projects, { ...projects[0]!, name: 'Renamed' });
	expect(renamed).toHaveLength(projects.length);
	expect(renamed[0]!.name).toBe('Renamed');
	expect(upsertProject(projects, { ...projects[0]!, id: 'new' })).toHaveLength(projects.length + 1);
	const counts = projectCounts(projects);
	expect(counts.get('team_1')).toBe(4);
	expect(counts.get('team_3')).toBe(2);
	expect(counts.get('team_5')).toBe(1);
});

test('groupRows: voting teams show progress, a single project goes straight through', () => {
	const projects = fixtureProjects();
	const voting = fixtureVoting('group', fixtureTeams, projects, 0.3);
	const teams = [...fixtureTeams, { ...fixtureTeams[0]!, id: 'team_empty', members: [] }];
	const rows = groupRows(voting, teams, projects);
	expect(rows.map((r) => r.mode)).toEqual(['vote', 'vote', 'vote', 'vote', 'through', 'none']);
	expect(rows[0]).toMatchObject({ cast: 4, eligible: 4, done: true });
	expect(rows[3]).toMatchObject({ cast: 0, done: false });
	expect(voting.group.teamsDone).toBe(rows.filter((r) => r.mode === 'vote' && r.done).length);
	expect(voting.group.teamsTotal).toBe(4);
});

test('pitchRanking joins the tally with projects and teams; draw note', () => {
	expect(pitchRanking(fixtureVoting('pitch'), fixtureTeams, fixtureProjects())).toEqual([]);
	const ranking = pitchRanking(fixtureVoting('results'), fixtureTeams, fixtureProjects());
	expect(ranking.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
	expect(ranking.every((r) => r.project && r.team && r.project.teamId === r.team.id)).toBe(true);
	expect(winnerByDraw(ranking)).toBe(false);
	const drawn = fixtureVoting('results', fixtureTeams, fixtureProjects(), 1, true);
	expect(winnerByDraw(pitchRanking(drawn, fixtureTeams, fixtureProjects()))).toBe(true);
});
