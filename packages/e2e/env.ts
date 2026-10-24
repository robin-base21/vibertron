// Shared settings for the e2e run. Ports can be overridden so the suite can run next to other servers.
export const API_PORT = Number(process.env.E2E_API_PORT ?? 4001);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4000);
export const API_URL = `http://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const ADMIN = { email: 'admin@e2e.test', password: 'e2e-admin-password' };
