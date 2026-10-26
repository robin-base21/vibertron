import type { EventDTO, ProjectDTO, TeamDTO, VotingActionBody, VotingStateDTO } from 'common';
import { hms } from '$lib/blueprint/live.svelte';

/** Manager-confirmed lifecycle steps after launch: ending the build plus the voting actions. */
export type LifecycleAction = 'end' | VotingActionBody['action'];

export type Stage = 'draft' | 'open' | 'live' | 'ended' | 'group' | 'pitch' | 'results';

export const STAGES: { id: Stage; label: string }[] = [
	{ id: 'draft', label: 'Draft' },
	{ id: 'open', label: 'Open' },
	{ id: 'live', label: 'Live' },
	{ id: 'ended', label: 'Time’s up' },
	{ id: 'group', label: 'Team vote' },
	{ id: 'pitch', label: 'Pitch vote' },
	{ id: 'results', label: 'Results' }
];

/** A live event whose clock ran out counts as "time's up" even before the server sweep. */
export function stageOf(event: Pick<EventDTO, 'status' | 'votingPhase' | 'endsAt'>, now: number): Stage {
	if (event.votingPhase !== 'none') return event.votingPhase;
	if (event.status === 'live' && event.endsAt !== null && event.endsAt <= now) return 'ended';
	return event.status;
}

export interface Confirmation {
	title: string;
	points: string[];
	confirmLabel: string;
	danger?: boolean;
}

interface Context {
	event: EventDTO;
	now: number;
	teams: TeamDTO[];
	projects: ProjectDTO[];
	voting: VotingStateDTO | null;
}

const listNames = (names: string[], max = 6) =>
	names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;

const teamName = (t: TeamDTO) => t.codename ?? t.name;

/** What a step will do, spelled out for the confirmation dialog. */
export function confirmationFor(action: LifecycleAction, { event, now, teams, projects, voting }: Context): Confirmation {
	const running = event.status === 'live' && event.endsAt !== null && event.endsAt > now;
	switch (action) {
		case 'end':
			return {
				title: 'End the build?',
				points: [
					`The countdown stops now${event.endsAt ? ` (${hms(event.endsAt - now)} left)` : ''} and messaging closes.`,
					'Voting does not start until you confirm it.'
				],
				confirmLabel: 'End event',
				danger: true
			};
		case 'start': {
			const members = teams.flatMap((t) => t.members);
			const named = new Set(projects.map((p) => p.participantId));
			const missing = members.filter((m) => !named.has(m.participantId)).map((m) => m.displayName);
			return {
				title: 'Start voting?',
				points: [
					...(running ? [`Ends the build now (${hms(event.endsAt! - now)} left).`] : []),
					`${projects.length} of ${members.length} attendees named a project.`,
					...(missing.length ? [`No project yet: ${listNames(missing)}. They can still vote.`] : []),
					'Project names lock.',
					'The TV switches to team voting. The team round closes by itself once every team has voted.'
				],
				confirmLabel: running ? 'End build and start voting' : 'Start voting'
			};
		}
		case 'close-group': {
			const open = (voting?.group.perTeam ?? [])
				.filter((p) => p.eligible > 0 && p.cast < p.eligible)
				.map((p) => {
					const t = teams.find((x) => x.id === p.teamId);
					return `${t ? teamName(t) : p.teamId} ${p.cast}/${p.eligible}`;
				});
			return {
				title: 'Close the team round?',
				points: [
					...(open.length ? [`Still voting: ${listNames(open)}. They are tallied with the ballots they have.`] : []),
					'The TV reveals the pitches and pitch voting opens.'
				],
				confirmLabel: 'Close team round'
			};
		}
		case 'close-pitch':
			return {
				title: 'Reveal the winner?',
				points: [
					`${voting?.pitch.cast ?? 0} of ${voting?.pitch.eligible ?? 0} ballots cast.`,
					'Pitch voting closes and the TV reveals the winner and the full ranking.'
				],
				confirmLabel: 'Reveal winner'
			};
		case 'reset':
			return {
				title: 'Reset voting?',
				points: ['All ballots and results are deleted.', 'Projects unlock for editing and the TV leaves voting.'],
				confirmLabel: 'Reset voting',
				danger: true
			};
	}
}
