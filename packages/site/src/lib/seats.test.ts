import { expect, test } from 'bun:test';
import { holdsSeat, seatsLeft, signupState, type SeatFields } from './seats';

const now = new Date('2026-11-20T12:00:00Z');
const later = new Date(now.getTime() + 3_600_000);
const earlier = new Date(now.getTime() - 3_600_000);
const base: SeatFields = {
	waitlist: false,
	paid: false,
	completedAt: null,
	proofAt: null,
	holdUntil: null,
	emailConfirmedAt: new Date('2026-11-20T11:00:00Z')
};

test('states, most decisive first', () => {
	expect(signupState({ ...base, holdUntil: later }, now)).toBe('held');
	expect(signupState({ ...base, holdUntil: earlier }, now)).toBe('expired');
	expect(signupState({ ...base, holdUntil: earlier, proofAt: earlier }, now)).toBe('proof');
	expect(signupState({ ...base, completedAt: earlier }, now)).toBe('confirmed');
	expect(signupState({ ...base, paid: true, holdUntil: earlier }, now)).toBe('paid');
	expect(signupState({ ...base, waitlist: true, completedAt: earlier }, now)).toBe('waitlist');
	// Paid wins over the waitlist flag (an admin confirmed the money).
	expect(signupState({ ...base, waitlist: true, paid: true }, now)).toBe('paid');
});

test('a saved seat (free events) never expires', () => {
	expect(signupState({ ...base, seatedAt: earlier }, now)).toBe('confirmed');
	expect(holdsSeat({ ...base, seatedAt: earlier, holdUntil: earlier }, now)).toBe(true);
	expect(seatsLeft(1, [{ ...base, seatedAt: earlier }], now)).toBe(0);
});

test('only live holds and finished signups take seats', () => {
	expect(holdsSeat({ ...base, holdUntil: later }, now)).toBe(true);
	expect(holdsSeat({ ...base, holdUntil: earlier }, now)).toBe(false);
	expect(holdsSeat({ ...base, waitlist: true, completedAt: earlier }, now)).toBe(false);
	const rows = [
		{ ...base, holdUntil: later },
		{ ...base, holdUntil: earlier },
		{ ...base, completedAt: earlier },
		{ ...base, waitlist: true, completedAt: earlier }
	];
	expect(seatsLeft(3, rows, now)).toBe(1);
	expect(seatsLeft(2, rows, now)).toBe(0);
	expect(seatsLeft(1, rows, now)).toBe(0);
	expect(seatsLeft(null, rows, now)).toBeNull();
});

test('an unconfirmed email only holds the seat inside its window', () => {
	const unconfirmed = { ...base, emailConfirmedAt: null };
	expect(signupState({ ...unconfirmed, holdUntil: later }, now)).toBe('unconfirmed');
	expect(holdsSeat({ ...unconfirmed, holdUntil: later }, now)).toBe(true);
	expect(signupState({ ...unconfirmed, holdUntil: earlier }, now)).toBe('expired');
	// Finishing every step (or sending a screenshot) doesn't keep the seat without a confirmed email.
	expect(holdsSeat({ ...unconfirmed, holdUntil: earlier, completedAt: earlier }, now)).toBe(false);
	expect(holdsSeat({ ...unconfirmed, holdUntil: earlier, proofAt: earlier }, now)).toBe(false);
	expect(holdsSeat({ ...unconfirmed, seatedAt: earlier }, now)).toBe(false);
	// An admin marking it paid still counts.
	expect(signupState({ ...unconfirmed, paid: true }, now)).toBe('paid');
	expect(signupState({ ...unconfirmed, waitlist: true }, now)).toBe('waitlist');
});

test('a cancelled signup frees its seat, whatever else it had', () => {
	const gone = { ...base, completedAt: earlier, paid: true, cancelledAt: earlier };
	expect(signupState(gone, now)).toBe('cancelled');
	expect(holdsSeat(gone, now)).toBe(false);
	expect(seatsLeft(1, [gone], now)).toBe(1);
});
