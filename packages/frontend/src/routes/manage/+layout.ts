import { requireRole } from '$lib/guards';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch, url }) => {
	await requireRole('manager', url, fetch);
	return {};
};
