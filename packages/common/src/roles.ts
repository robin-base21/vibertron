import { z } from 'zod';

// Viewers are anonymous and have no role.
export const Role = z.enum(['admin', 'manager', 'attendee']);
export type Role = z.infer<typeof Role>;

const rank: Record<Role, number> = { attendee: 0, manager: 1, admin: 2 };

export function hasRole(actual: Role | undefined, required: Role): boolean {
	return actual !== undefined && rank[actual] >= rank[required];
}
