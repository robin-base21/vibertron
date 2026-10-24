import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// Phase 0 stub. Full data model lands in Phase 1 (see ROADMAP.md).
export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	role: text('role', { enum: ['admin', 'manager', 'attendee'] }).notNull(),
	email: text('email').unique(),
	passwordHash: text('password_hash'),
	displayName: text('display_name').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
});
