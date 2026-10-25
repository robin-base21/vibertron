// Typed wrappers for every endpoint in common/src/api.ts. UI code never builds URLs by hand.
// Request bodies are parsed with the shared zod schemas before sending.
import {
	AnalyzeBody,
	BallotBody,
	CodenameBody,
	CreateEventBody,
	CreateInviteBody,
	CreateUserBody,
	JoinBody,
	LaunchBody,
	LaunchPreviewBody,
	LoginBody,
	MessageBody,
	ModerateBody,
	PairBody,
	ProjectBody,
	SaveBlueprintBody,
	UpdateEventBody,
	UpdateInviteBody,
	UpdateUserBody,
	VotingActionBody,
	type AnalyzeResultDTO,
	type AttendeeContextDTO,
	type Blueprint,
	type EventDTO,
	type InviteDTO,
	type JoinCodeDTO,
	type LaunchPreviewDTO,
	type LiveSnapshotDTO,
	type MeDTO,
	type MessageDTO,
	type PairingDTO,
	type ParticipantDTO,
	type ProjectDTO,
	type PublicEventDTO,
	type TeamDTO,
	type UserDTO,
	type VotingStateDTO
} from 'common';
import { API_URL as API_BASE } from '$lib/env';
import { api, type Fetch } from './client';

export { api as request, ApiError } from './client';
export type { Fetch } from './client';

/** Input type of a zod schema (before trim/uppercase transforms). */
type In<T extends { _zod: { input: unknown } }> = T['_zod']['input'];
type Ok = { ok: true };
const e = encodeURIComponent;

export const auth = {
	login: (body: In<typeof LoginBody>) =>
		api<{ user: UserDTO }>('/api/auth/login', { body: LoginBody.parse(body) }),
	logout: () => api<Ok>('/api/auth/logout', { method: 'POST' }),
	me: (fetch?: Fetch) => api<MeDTO>('/api/auth/me', { fetch })
};

export const admin = {
	listUsers: (fetch?: Fetch) => api<{ users: UserDTO[] }>('/api/admin/users', { fetch }),
	createUser: (body: In<typeof CreateUserBody>) =>
		api<{ user: UserDTO }>('/api/admin/users', { body: CreateUserBody.parse(body) }),
	updateUser: (id: string, body: In<typeof UpdateUserBody>) =>
		api<{ user: UserDTO }>(`/api/admin/users/${e(id)}`, {
			method: 'PATCH',
			body: UpdateUserBody.parse(body)
		}),
	deleteUser: (id: string) => api<Ok>(`/api/admin/users/${e(id)}`, { method: 'DELETE' })
};

export const events = {
	list: (fetch?: Fetch) => api<{ events: EventDTO[] }>('/api/events', { fetch }),
	create: (body: In<typeof CreateEventBody>) =>
		api<{ event: EventDTO }>('/api/events', { body: CreateEventBody.parse(body) }),
	get: (id: string, fetch?: Fetch) => api<{ event: EventDTO }>(`/api/events/${e(id)}`, { fetch }),
	update: (id: string, body: In<typeof UpdateEventBody>) =>
		api<{ event: EventDTO }>(`/api/events/${e(id)}`, {
			method: 'PATCH',
			body: UpdateEventBody.parse(body)
		}),
	remove: (id: string) => api<Ok>(`/api/events/${e(id)}`, { method: 'DELETE' }),
	participants: (id: string, fetch?: Fetch) =>
		api<{ participants: ParticipantDTO[] }>(`/api/events/${e(id)}/participants`, { fetch }),
	removeParticipant: (id: string, pid: string) =>
		api<Ok>(`/api/events/${e(id)}/participants/${e(pid)}`, { method: 'DELETE' })
};

export const invites = {
	list: (eventId: string, fetch?: Fetch) =>
		api<{ invites: InviteDTO[] }>(`/api/events/${e(eventId)}/invites`, { fetch }),
	create: (eventId: string, body: In<typeof CreateInviteBody> = {}) =>
		api<{ invite: InviteDTO }>(`/api/events/${e(eventId)}/invites`, {
			body: CreateInviteBody.parse(body)
		}),
	update: (id: string, body: In<typeof UpdateInviteBody>) =>
		api<{ invite: InviteDTO }>(`/api/invites/${e(id)}`, {
			method: 'PATCH',
			body: UpdateInviteBody.parse(body)
		}),
	code: (id: string, fetch?: Fetch) => api<JoinCodeDTO>(`/api/invites/${e(id)}/code`, { fetch })
};

export const join = {
	get: (token: string, fetch?: Fetch) =>
		api<{ event: PublicEventDTO }>(`/api/join/${e(token)}`, { fetch }),
	join: (token: string, body: In<typeof JoinBody>) =>
		api<{ user: UserDTO; participant: ParticipantDTO; event: PublicEventDTO }>(
			`/api/join/${e(token)}`,
			{ body: JoinBody.parse(body) }
		)
};

export const attendee = {
	me: (slug: string, fetch?: Fetch) => api<AttendeeContextDTO>(`/api/e/${e(slug)}/me`, { fetch }),
	pair: (slug: string, body: In<typeof PairBody>) =>
		api<{ pairing: PairingDTO }>(`/api/e/${e(slug)}/pairings`, { body: PairBody.parse(body) }),
	acceptPairing: (id: string) =>
		api<{ pairing: PairingDTO }>(`/api/pairings/${e(id)}/accept`, { method: 'POST' }),
	deletePairing: (id: string) => api<Ok>(`/api/pairings/${e(id)}`, { method: 'DELETE' }),
	setCodename: (teamId: string, body: In<typeof CodenameBody>) =>
		api<{ team: TeamDTO }>(`/api/teams/${e(teamId)}`, {
			method: 'PATCH',
			body: CodenameBody.parse(body)
		}),
	postMessage: (slug: string, body: In<typeof MessageBody>) =>
		api<{ message: MessageDTO }>(`/api/e/${e(slug)}/messages`, { body: MessageBody.parse(body) }),
	saveProject: (slug: string, body: In<typeof ProjectBody>) =>
		api<{ project: ProjectDTO }>(`/api/e/${e(slug)}/project`, {
			method: 'PUT',
			body: ProjectBody.parse(body)
		}),
	saveBallot: (slug: string, body: In<typeof BallotBody>) =>
		api<{ ok: true; voting: VotingStateDTO }>(`/api/e/${e(slug)}/ballot`, {
			method: 'PUT',
			body: BallotBody.parse(body)
		})
};

export const blueprints = {
	get: (eventId: string, fetch?: Fetch) =>
		api<{ blueprint: Blueprint | null; version: number }>(`/api/events/${e(eventId)}/blueprint`, {
			fetch
		}),
	save: (eventId: string, body: In<typeof SaveBlueprintBody>) =>
		api<{ version: number }>(`/api/events/${e(eventId)}/blueprint`, {
			method: 'PUT',
			body: SaveBlueprintBody.parse(body)
		}),
	upload: (eventId: string, file: File | Blob) => {
		const form = new FormData();
		form.append('file', file);
		return api<{ imageRef: string }>(`/api/events/${e(eventId)}/uploads`, { body: form });
	},
	/** URL for an uploaded image (public, for <img src>). */
	uploadUrl: (imageRef: string) => `${API_BASE}/api/uploads/${e(imageRef)}`,
	analyze: (eventId: string, body: In<typeof AnalyzeBody>) =>
		api<AnalyzeResultDTO>(`/api/events/${e(eventId)}/blueprint/analyze`, {
			body: AnalyzeBody.parse(body)
		})
};

export const launch = {
	preview: (eventId: string, body: In<typeof LaunchPreviewBody>) =>
		api<LaunchPreviewDTO>(`/api/events/${e(eventId)}/launch/preview`, {
			body: LaunchPreviewBody.parse(body)
		}),
	launch: (eventId: string, body: In<typeof LaunchBody>) =>
		api<{ event: EventDTO; teams: TeamDTO[] }>(`/api/events/${e(eventId)}/launch`, {
			body: LaunchBody.parse(body)
		}),
	end: (eventId: string) =>
		api<{ event: EventDTO }>(`/api/events/${e(eventId)}/end`, { method: 'POST' }),
	moderate: (messageId: string, body: In<typeof ModerateBody>) =>
		api<{ message: MessageDTO }>(`/api/messages/${e(messageId)}`, {
			method: 'PATCH',
			body: ModerateBody.parse(body)
		})
};

export const voting = {
	action: (eventId: string, body: In<typeof VotingActionBody>) =>
		api<{ event: EventDTO; voting: VotingStateDTO }>(`/api/events/${e(eventId)}/voting`, {
			body: VotingActionBody.parse(body)
		})
};

export const live = {
	snapshot: (slug: string, fetch?: Fetch) =>
		api<LiveSnapshotDTO>(`/api/e/${e(slug)}/live`, { fetch }),
	health: (fetch?: Fetch) => api<{ ok: true; time: number }>('/api/health', { fetch })
};
