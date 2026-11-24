import { env } from '$env/dynamic/public';
import { dev } from '$app/environment';

// Unset in production means same origin: the reverse proxy routes /api and /ws to the backend.
const origin = typeof location === 'undefined' ? '' : location.origin;
const fallbackApi = dev ? 'http://localhost:3001' : origin;

export const API_URL = env.PUBLIC_API_URL || fallbackApi;
export const WS_URL = env.PUBLIC_WS_URL || `${API_URL.replace(/^http/, 'ws')}/ws`;
