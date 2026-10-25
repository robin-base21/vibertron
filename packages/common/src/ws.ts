import { z } from 'zod';
import type { EventDTO, MessageDTO, PairingDTO, ParticipantDTO, ProjectDTO, PublicEventDTO, TeamDTO, LiveSnapshotDTO, VotingStateDTO } from './api';
import type { Blueprint } from './blueprint';

/*
WebSocket at /ws. The upgrade request carries the session cookie (if any).
Topics (server-side, via server.publish):
  event:{eventId}          public live updates (anyone subscribed with scope 'public')
  event:{eventId}:manage   manager-only updates (event manager or admin)
  user:{userId}            personal updates (pairing requests, team assignment)
Users with a session are auto-subscribed to user:{userId} on open.
*/

export const ClientEvent = z.discriminatedUnion('type', [
	z.object({ type: z.literal('ping') }),
	z.object({ type: z.literal('subscribe'), slug: z.string(), scope: z.enum(['public', 'manage']) }),
	z.object({ type: z.literal('unsubscribe'), slug: z.string() })
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

export type ServerEvent =
	| { type: 'pong'; serverTime: number }
	| { type: 'error'; message: string }
	| { type: 'subscribed'; slug: string; scope: 'public' | 'manage'; snapshot: LiveSnapshotDTO }
	// public
	| { type: 'event.updated'; event: PublicEventDTO; serverTime: number }
	| { type: 'blueprint.updated'; eventId: string; blueprint: Blueprint }
	| { type: 'launched'; snapshot: LiveSnapshotDTO }
	| { type: 'team.updated'; team: TeamDTO }
	| { type: 'message.created'; message: MessageDTO }
	| { type: 'message.hidden'; messageId: string; hidden: boolean }
	| { type: 'participants.count'; eventId: string; count: number }
	| { type: 'project.updated'; project: ProjectDTO }
	/** After every ballot and phase change (phase changes also send event.updated). */
	| { type: 'voting.updated'; eventId: string; voting: VotingStateDTO }
	// manage
	| { type: 'participants.updated'; eventId: string; participants: ParticipantDTO[] }
	| { type: 'event.manage.updated'; event: EventDTO }
	| { type: 'message.manage'; message: MessageDTO }
	// personal
	| { type: 'pairing.updated'; pairing: PairingDTO; removed?: boolean }
	| { type: 'assignment'; eventId: string; team: TeamDTO; stationId: string };

export const topics = {
	event: (eventId: string) => `event:${eventId}`,
	manage: (eventId: string) => `event:${eventId}:manage`,
	user: (userId: string) => `user:${userId}`
};
