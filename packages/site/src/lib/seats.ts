/*
Seat rules (pure, shared by server and admin UI):
- Step 1 holds a seat for CONFIRM_WINDOW_MS. It only becomes theirs once they click the link in the
  confirmation email, so made-up addresses never keep a seat for long.
- A confirmed signup holds a seat unless it is on the waitlist, and it is finished, paid, has sent its
  deposit proof, has a saved seat (free events save it on confirmation), or is inside its hold window
  (holdUntil: the deposit hold of a paid event).
- Anything else whose hold ran out frees its seat ("expired").
- Paid wins over everything but a cancellation: an admin checked the money.
- A cancelled signup never holds a seat.
*/

/** How long an unconfirmed signup keeps its seat. */
export const CONFIRM_WINDOW_MS = 2 * 3_600_000;

export interface SeatFields {
	waitlist: boolean;
	paid: boolean;
	completedAt: Date | null;
	proofAt: Date | null;
	holdUntil: Date | null;
	/** Seat saved without a time limit (free events). */
	seatedAt?: Date | null;
	/** Clicked the confirmation link; null: unconfirmed. */
	emailConfirmedAt: Date | null;
	/** The person cancelled. */
	cancelledAt?: Date | null;
}

export type SignupState =
	'cancelled' | 'paid' | 'waitlist' | 'unconfirmed' | 'proof' | 'confirmed' | 'held' | 'expired';

export function signupState(s: SeatFields, now: Date): SignupState {
	if (s.cancelledAt) return 'cancelled';
	if (s.paid) return 'paid';
	if (s.waitlist) return 'waitlist';
	if (!s.emailConfirmedAt) return s.holdUntil && s.holdUntil > now ? 'unconfirmed' : 'expired';
	if (s.proofAt) return 'proof';
	if (s.completedAt || s.seatedAt) return 'confirmed';
	if (s.holdUntil && s.holdUntil > now) return 'held';
	return 'expired';
}

export const holdsSeat = (s: SeatFields, now: Date) => {
	const state = signupState(s, now);
	return state !== 'waitlist' && state !== 'expired' && state !== 'cancelled';
};

/** Seats left (null: no limit). */
export function seatsLeft(
	capacity: number | null,
	signups: SeatFields[],
	now: Date
): number | null {
	if (capacity === null) return null;
	return Math.max(0, capacity - signups.filter((s) => holdsSeat(s, now)).length);
}

export const STATE_LABEL: Record<SignupState, string> = {
	cancelled: 'Cancelled',
	paid: 'Paid',
	waitlist: 'Waitlist',
	unconfirmed: 'Email unconfirmed',
	proof: 'Deposit sent',
	confirmed: 'Confirmed',
	held: 'Seat held',
	expired: 'Hold expired'
};
