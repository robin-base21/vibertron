import { expect, test } from 'bun:test';
import { refundDeadline, refundOnCancel } from './refund';

const start = new Date('2027-03-10T04:00:00Z');

test('deadline is N days before the start', () => {
	expect(refundDeadline(start, 3)?.toISOString()).toBe('2027-03-07T04:00:00.000Z');
	expect(refundDeadline(start, 0)?.toISOString()).toBe(start.toISOString());
	expect(refundDeadline(start, null)).toBeNull();
	expect(refundDeadline(null, 3)).toBeNull();
});

test('cancelling up to the deadline gets the deposit back, later does not', () => {
	expect(refundOnCancel(new Date('2027-03-07T03:59:00Z'), start, 3)).toBe(true);
	expect(refundOnCancel(new Date('2027-03-07T04:00:00Z'), start, 3)).toBe(true);
	expect(refundOnCancel(new Date('2027-03-07T04:01:00Z'), start, 3)).toBe(false);
	expect(refundOnCancel(new Date('2027-03-09T00:00:00Z'), start, null)).toBeNull();
});
