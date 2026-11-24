import { showcaseItems } from '$lib/server/events';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ items: showcaseItems() });
