import { expect, test } from 'bun:test';
import { hasRole } from './roles';

test('role hierarchy', () => {
	expect(hasRole('admin', 'manager')).toBe(true);
	expect(hasRole('manager', 'admin')).toBe(false);
	expect(hasRole('attendee', 'attendee')).toBe(true);
	expect(hasRole(undefined, 'attendee')).toBe(false);
});
