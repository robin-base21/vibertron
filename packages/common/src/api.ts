import { z } from 'zod';
import { Blueprint, Point } from './blueprint';
import { Role } from './roles';

/*
REST contract. All routes are under /api, JSON in/out, session cookie `vt_session`
(httpOnly, SameSite=Lax), sent with `credentials: 'include'`.
Errors: non-2xx with body ApiErrorBody.

Auth
  POST   /api/auth/login                    LoginBody            -> { user: UserDTO }
  POST   /api/auth/logout                                        -> { ok: true }
  GET    /api/auth/me                                            -> MeDTO
Admin (admin)
  GET    /api/admin/users                                        -> { users: UserDTO[] }
  POST   /api/admin/users                   CreateUserBody       -> { user: UserDTO }
  PATCH  /api/admin/users/:id               UpdateUserBody       -> { user: UserDTO }
  DELETE /api/admin/users/:id                                    -> { ok: true }
Events (manager owns; admin sees/edits all)
  GET    /api/events                                             -> { events: EventDTO[] }
  POST   /api/events                        CreateEventBody      -> { event: EventDTO }
  GET    /api/events/:id                                         -> { event: EventDTO }
  PATCH  /api/events/:id                    UpdateEventBody      -> { event: EventDTO }
  DELETE /api/events/:id                                         -> { ok: true }
  GET    /api/events/:id/participants                            -> { participants: ParticipantDTO[] }
  DELETE /api/events/:id/participants/:pid                       -> { ok: true }
Invites (event manager)
  GET    /api/events/:id/invites                                 -> { invites: InviteDTO[] }
  POST   /api/events/:id/invites            CreateInviteBody     -> { invite: InviteDTO }
  PATCH  /api/invites/:id                   UpdateInviteBody     -> { invite: InviteDTO }
  GET    /api/invites/:id/code                                   -> JoinCodeDTO   (rotating)
Join (public)
  GET    /api/join/:token                                        -> { event: PublicEventDTO }
  POST   /api/join/:token                   JoinBody             -> { user: UserDTO; participant: ParticipantDTO; event: PublicEventDTO }
Attendee (participant of the event)
  GET    /api/e/:slug/me                                         -> AttendeeContextDTO
  POST   /api/e/:slug/pairings              PairBody             -> { pairing: PairingDTO }
  POST   /api/pairings/:id/accept                                -> { pairing: PairingDTO }
  DELETE /api/pairings/:id                                       -> { ok: true }
  PATCH  /api/teams/:id                     CodenameBody         -> { team: TeamDTO }      (team member, event live)
  POST   /api/e/:slug/messages              MessageBody          -> { message: MessageDTO } (team has codename)
Blueprints (event manager)
  GET    /api/events/:id/blueprint                               -> { blueprint: Blueprint | null; version: number }
  PUT    /api/events/:id/blueprint          SaveBlueprintBody    -> { version: number }     (409 on version mismatch)
  POST   /api/events/:id/uploads            multipart "file"     -> { imageRef: string }
  GET    /api/uploads/:imageRef                                  -> image bytes (public; refs are unguessable)
  POST   /api/events/:id/blueprint/analyze  AnalyzeBody          -> AnalyzeResultDTO
Launch / live (event manager)
  POST   /api/events/:id/launch/preview     LaunchPreviewBody    -> LaunchPreviewDTO
  POST   /api/events/:id/launch             LaunchBody           -> { event: EventDTO; teams: TeamDTO[] }  (409 + ApiErrorBody on capacity)
  POST   /api/events/:id/end                                     -> { event: EventDTO }
  PATCH  /api/messages/:id                  ModerateBody         -> { message: MessageDTO }
Public (anyone)
  GET    /api/e/:slug/live                                       -> LiveSnapshotDTO
  GET    /api/health                                             -> { ok: true; time: number }
*/

export interface ApiErrorBody {
	error: string;
	message: string;
	details?: unknown;
}

// ---------- DTOs ----------

export interface UserDTO {
	id: string;
	role: Role;
	email: string | null;
	displayName: string;
	createdAt: number;
}

export interface MeDTO {
	user: UserDTO | null;
	/** Events the user participates in (attendees). */
	participations: { eventId: string; slug: string; participantId: string }[];
}

export const EventStatus = z.enum(['draft', 'open', 'live', 'ended']);
export type EventStatus = z.infer<typeof EventStatus>;

export interface PublicEventDTO {
	id: string;
	slug: string;
	name: string;
	status: EventStatus;
	teamSize: number | null;
	durationMin: number | null;
	startedAt: number | null;
	endsAt: number | null;
}

export interface EventDTO extends PublicEventDTO {
	managerId: string;
	participantCount: number;
	createdAt: number;
}

export interface InviteDTO {
	id: string;
	eventId: string;
	token: string;
	active: boolean;
	expiresAt: number | null;
	createdAt: number;
}

export interface JoinCodeDTO {
	code: string;
	/** Path for the QR, e.g. `/join/<token>?c=<code>`; prepend the frontend origin. */
	joinPath: string;
	windowStart: number;
	windowMs: number;
	serverTime: number;
}

export interface ParticipantDTO {
	id: string;
	eventId: string;
	userId: string;
	displayName: string;
	friendCode: string;
	teamId: string | null;
	joinedAt: number;
}

export interface PairingDTO {
	id: string;
	fromParticipantId: string;
	fromName: string;
	toParticipantId: string;
	toName: string;
	accepted: boolean;
}

export interface TeamMemberDTO {
	participantId: string;
	displayName: string;
	stationId: string;
}

export interface TeamDTO {
	id: string;
	eventId: string;
	name: string;
	codename: string | null;
	segmentId: string;
	members: TeamMemberDTO[];
}

export interface AttendeeContextDTO {
	event: PublicEventDTO;
	participant: ParticipantDTO;
	pairings: PairingDTO[];
	team: TeamDTO | null;
	/** Present once live. */
	stationId: string | null;
	blueprint: Blueprint | null;
}

export interface MessageDTO {
	id: string;
	eventId: string;
	teamId: string;
	codename: string;
	authorName: string;
	body: string;
	hidden: boolean;
	createdAt: number;
}

export interface LiveSnapshotDTO {
	event: PublicEventDTO;
	blueprint: Blueprint | null;
	teams: TeamDTO[];
	/** Visible messages, newest last, at most 50. Managers of the event also get hidden ones. */
	messages: MessageDTO[];
	participantCount: number;
	serverTime: number;
}

export interface LaunchPreviewDTO {
	ok: boolean;
	participants: number;
	teams: number;
	stationsAvailable: number;
	unconfirmedSegments: string[];
	message?: string;
}

/** OpenRouter result: suggested segments (confirmed=false) plus outlines echoed back. */
export interface AnalyzeResultDTO {
	blueprint: Blueprint;
	/** 'ai' when the model answered, 'fallback' when AI failed and only contours were used. */
	source: 'ai' | 'fallback';
	warning?: string;
}

// ---------- Request bodies ----------

export const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
export type LoginBody = z.infer<typeof LoginBody>;

export const CreateUserBody = z.object({
	email: z.string().email(),
	password: z.string().min(8),
	displayName: z.string().min(1).max(60),
	role: z.enum(['admin', 'manager'])
});
export type CreateUserBody = z.infer<typeof CreateUserBody>;

export const UpdateUserBody = z.object({
	role: Role.optional(),
	displayName: z.string().min(1).max(60).optional(),
	password: z.string().min(8).optional()
});
export type UpdateUserBody = z.infer<typeof UpdateUserBody>;

export const CreateEventBody = z.object({
	name: z.string().min(1).max(80),
	slug: z
		.string()
		.regex(/^[a-z0-9-]{3,40}$/)
		.optional()
});
export type CreateEventBody = z.infer<typeof CreateEventBody>;

export const UpdateEventBody = z.object({
	name: z.string().min(1).max(80).optional(),
	/** Only draft <-> open here; live/ended go through launch/end. */
	status: z.enum(['draft', 'open']).optional()
});
export type UpdateEventBody = z.infer<typeof UpdateEventBody>;

export const CreateInviteBody = z.object({ expiresAt: z.number().int().optional() });
export type CreateInviteBody = z.infer<typeof CreateInviteBody>;

export const UpdateInviteBody = z.object({ active: z.boolean() });
export type UpdateInviteBody = z.infer<typeof UpdateInviteBody>;

export const JoinBody = z.object({
	code: z.string().trim().toUpperCase().length(6),
	displayName: z.string().trim().min(1).max(40)
});
export type JoinBody = z.infer<typeof JoinBody>;

export const PairBody = z.object({ friendCode: z.string().trim().toUpperCase().min(4).max(8) });
export type PairBody = z.infer<typeof PairBody>;

export const CodenameBody = z.object({ codename: z.string().trim().min(1).max(32) });
export type CodenameBody = z.infer<typeof CodenameBody>;

export const MESSAGE_MAX_LENGTH = 280;
export const MESSAGE_RATE_LIMIT_MS = 10_000;

export const MessageBody = z.object({ body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH) });
export type MessageBody = z.infer<typeof MessageBody>;

export const ModerateBody = z.object({ hidden: z.boolean() });
export type ModerateBody = z.infer<typeof ModerateBody>;

export const SaveBlueprintBody = z.object({ blueprint: Blueprint, version: z.number().int().min(0) });
export type SaveBlueprintBody = z.infer<typeof SaveBlueprintBody>;

/** rooms[i] is drawn as number i + ROOM_MARK_BASE on the marked image (shared by client and prompt). */
export const ROOM_MARK_BASE = 1;

export const AnalyzeRoom = z.object({
	/** Orthogonal polygon or 2-point rect ([[x0,y0],[x1,y1]]) in canvas coordinates. */
	points: z.array(Point).min(2),
	shape: z.enum(['rect', 'polygon'])
});
export type AnalyzeRoom = z.infer<typeof AnalyzeRoom>;

export const AnalyzeBody = z.object({
	/** The original upload (becomes the underlay). */
	imageRef: z.string(),
	/**
	 * v2: the cropped building image with each room outlined and numbered (Set-of-Marks),
	 * uploaded by the client. Sent to the model instead of the original when present.
	 */
	markedImageRef: z.string().optional(),
	/** v2: building envelope as fractions of the original image; the canvas maps to it. */
	crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) }).optional(),
	/** v2: rooms detected by the CV pass, indexed as numbered on the marked image. */
	rooms: z.array(AnalyzeRoom).max(80).default([]),
	/** v2: vectorized wall segments in canvas coordinates. */
	walls: z.array(z.tuple([Point, Point])).max(600).default([]),
	/** Legacy (v1): candidate room polygons. */
	candidates: z.array(z.array(Point).min(3)).max(80).default([]),
	/** Legacy (v1): decorative outlines. */
	outlines: z.array(z.array(Point).min(2)).max(400).default([]),
	/** Canvas the geometry is normalized to (long side 1000, envelope aspect ratio). Defaults to 1000x1000. */
	canvas: z.object({ w: z.number().positive().max(10_000), h: z.number().positive().max(10_000) }).optional()
});
export type AnalyzeBody = z.infer<typeof AnalyzeBody>;

export const LaunchPreviewBody = z.object({ teamSize: z.number().int().min(1).max(20) });
export type LaunchPreviewBody = z.infer<typeof LaunchPreviewBody>;

export const LaunchBody = z.object({
	teamSize: z.number().int().min(1).max(20),
	durationMin: z.number().int().min(1).max(60 * 72),
	seed: z.number().int().optional()
});
export type LaunchBody = z.infer<typeof LaunchBody>;
