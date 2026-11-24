/*
Deposit refunds on cancellation (pure, shared by server and pages):
- An event can set refundDays: cancelling at least that many days before it starts gets the deposit
  back. null: no rule (the organiser decides case by case).
- Only a deposit that was paid (or whose screenshot was sent) is refunded.
*/

const DAY = 86_400_000;

/** Last moment to cancel with the deposit back; null without a rule or a start time. */
export function refundDeadline(startsAt: Date | null, refundDays: number | null): Date | null {
	if (!startsAt || refundDays === null) return null;
	return new Date(startsAt.getTime() - refundDays * DAY);
}

/** Does cancelling at `at` get the deposit back? null: no rule, the organiser decides. */
export function refundOnCancel(
	at: Date,
	startsAt: Date | null,
	refundDays: number | null
): boolean | null {
	const deadline = refundDeadline(startsAt, refundDays);
	return deadline ? at.getTime() <= deadline.getTime() : null;
}
