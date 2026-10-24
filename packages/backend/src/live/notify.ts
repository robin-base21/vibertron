import { eq } from 'drizzle-orm';
import type { App } from '../app';
import type { Event } from '../auth/guards';
import { participants } from '../db/schema';
import { eventDTO, pairingDTO, participantCount, participantDTOs, publicEventDTO } from '../dto';
import type { PairingDTO } from 'common';

/** participants.updated (manage) + participants.count (public). */
export function notifyParticipants(app: App, eventId: string) {
	app.live.toManagers(eventId, { type: 'participants.updated', eventId, participants: participantDTOs(app.db, eventId) });
	app.live.toEvent(eventId, { type: 'participants.count', eventId, count: participantCount(app.db, eventId) });
}

/** event.updated (public) + event.manage.updated (manage). */
export function notifyEvent(app: App, event: Event) {
	app.live.toEvent(event.id, { type: 'event.updated', event: publicEventDTO(event), serverTime: Date.now() });
	app.live.toManagers(event.id, { type: 'event.manage.updated', event: eventDTO(app.db, event) });
}

function userIdOf(app: App, participantId: string): string | undefined {
	return app.db.select({ userId: participants.userId }).from(participants).where(eq(participants.id, participantId)).get()?.userId;
}

/** pairing.updated to both users of the pairing. */
export function notifyPairing(app: App, pairing: PairingDTO | string, removed = false) {
	const dto = typeof pairing === 'string' ? pairingDTO(app.db, pairing) : pairing;
	if (!dto) return;
	for (const pid of [dto.fromParticipantId, dto.toParticipantId]) {
		const userId = userIdOf(app, pid);
		if (userId) app.live.toUser(userId, removed ? { type: 'pairing.updated', pairing: dto, removed: true } : { type: 'pairing.updated', pairing: dto });
	}
}
