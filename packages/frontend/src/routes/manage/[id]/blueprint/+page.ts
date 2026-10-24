import { dev } from '$app/environment';
import { emptyBlueprint, type Blueprint, type EventStatus } from 'common';
import { blueprints, events } from '$lib/api';
import { requireRole } from '$lib/guards';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url, fetch }) => {
	if (dev && url.searchParams.has('fixture')) {
		const { fixtureBlueprint } = await import('$lib/blueprint/fixtures');
		const status = (url.searchParams.get('status') ?? 'draft') as EventStatus;
		return { eventId: params.id, eventName: 'Fixture event', eventStatus: status, blueprint: fixtureBlueprint, version: 0, fixture: true };
	}
	await requireRole('manager', url, fetch);
	const [{ event }, saved] = await Promise.all([events.get(params.id, fetch), blueprints.get(params.id, fetch)]);
	const blueprint: Blueprint = saved.blueprint ?? emptyBlueprint(event.name);
	return { eventId: params.id, eventName: event.name, eventStatus: event.status, blueprint, version: saved.version, fixture: false };
};
