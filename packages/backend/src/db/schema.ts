import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';

const createdAt = () =>
	integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date());

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	role: text('role', { enum: ['admin', 'manager', 'attendee'] }).notNull(),
	email: text('email').unique(),
	passwordHash: text('password_hash'),
	displayName: text('display_name').notNull(),
	createdAt: createdAt()
});

export const sessions = sqliteTable(
	'sessions',
	{
		/** sha256 (hex) of the cookie token. */
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: createdAt()
	},
	(t) => [index('sessions_user_idx').on(t.userId)]
);

export const events = sqliteTable('events', {
	id: text('id').primaryKey(),
	managerId: text('manager_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	status: text('status', { enum: ['draft', 'open', 'live', 'ended'] })
		.notNull()
		.default('draft'),
	teamSize: integer('team_size'),
	durationMin: integer('duration_min'),
	startedAt: integer('started_at', { mode: 'timestamp_ms' }),
	endsAt: integer('ends_at', { mode: 'timestamp_ms' }),
	joinSecret: text('join_secret').notNull(),
	/** Team assignment seed, stored at launch so results are reproducible. */
	seed: integer('seed'),
	createdAt: createdAt()
});

export const invites = sqliteTable(
	'invites',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		token: text('token').notNull().unique(),
		active: integer('active', { mode: 'boolean' }).notNull().default(true),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
		createdAt: createdAt()
	},
	(t) => [index('invites_event_idx').on(t.eventId)]
);

export const participants = sqliteTable(
	'participants',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		friendCode: text('friend_code').notNull(),
		lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' }),
		joinedAt: integer('joined_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		uniqueIndex('participants_event_user_idx').on(t.eventId, t.userId),
		uniqueIndex('participants_event_friend_idx').on(t.eventId, t.friendCode)
	]
);

export const pairings = sqliteTable(
	'pairings',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		fromParticipantId: text('from_participant_id')
			.notNull()
			.references(() => participants.id, { onDelete: 'cascade' }),
		toParticipantId: text('to_participant_id')
			.notNull()
			.references(() => participants.id, { onDelete: 'cascade' }),
		accepted: integer('accepted', { mode: 'boolean' }).notNull().default(false),
		createdAt: createdAt()
	},
	(t) => [index('pairings_event_idx').on(t.eventId)]
);

export const blueprints = sqliteTable('blueprints', {
	id: text('id').primaryKey(),
	eventId: text('event_id')
		.notNull()
		.unique()
		.references(() => events.id, { onDelete: 'cascade' }),
	/** Blueprint JSON (common/src/blueprint.ts). */
	json: text('json').notNull(),
	version: integer('version').notNull().default(1),
	underlayPath: text('underlay_path'),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
});

export const uploads = sqliteTable('uploads', {
	/** Random 32-hex ref; also the file name on disk. */
	ref: text('ref').primaryKey(),
	eventId: text('event_id').references(() => events.id, { onDelete: 'set null' }),
	contentType: text('content_type').notNull(),
	size: integer('size').notNull(),
	createdAt: createdAt()
});

export const teams = sqliteTable(
	'teams',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		codename: text('codename'),
		segmentId: text('segment_id').notNull(),
		/** JSON string[] */
		stationIds: text('station_ids').notNull(),
		position: integer('position').notNull().default(0)
	},
	(t) => [index('teams_event_idx').on(t.eventId)]
);

export const teamMembers = sqliteTable(
	'team_members',
	{
		teamId: text('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		participantId: text('participant_id')
			.notNull()
			.references(() => participants.id, { onDelete: 'cascade' }),
		stationId: text('station_id').notNull()
	},
	(t) => [primaryKey({ columns: [t.teamId, t.participantId] }), uniqueIndex('team_members_participant_idx').on(t.participantId)]
);

export const messages = sqliteTable(
	'messages',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => events.id, { onDelete: 'cascade' }),
		teamId: text('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		participantId: text('participant_id')
			.notNull()
			.references(() => participants.id, { onDelete: 'cascade' }),
		body: text('body').notNull(),
		hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
		createdAt: createdAt()
	},
	(t) => [index('messages_event_idx').on(t.eventId, t.createdAt)]
);
