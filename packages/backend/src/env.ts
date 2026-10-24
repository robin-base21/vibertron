export interface Env {
	port: number;
	databasePath: string;
	uploadDir: string;
	corsOrigin: string;
	openrouterApiKey: string;
	openrouterModel: string;
	adminEmail: string;
	adminPassword: string;
	/** Secure flag on the session cookie. */
	secureCookies: boolean;
	messageRateLimitMs: number;
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
	return {
		port: Number(source.PORT ?? 3001),
		databasePath: source.DATABASE_PATH ?? './data/vibertron.sqlite',
		uploadDir: source.UPLOAD_DIR ?? './data/uploads',
		corsOrigin: source.CORS_ORIGIN ?? 'http://localhost:3000',
		openrouterApiKey: source.OPENROUTER_API_KEY ?? '',
		openrouterModel: source.OPENROUTER_MODEL || 'google/gemini-2.5-pro',
		adminEmail: source.ADMIN_EMAIL ?? '',
		adminPassword: source.ADMIN_PASSWORD ?? '',
		secureCookies: source.COOKIE_SECURE === 'true',
		messageRateLimitMs: source.MESSAGE_RATE_LIMIT_MS ? Number(source.MESSAGE_RATE_LIMIT_MS) : 10_000
	};
}

export const env = loadEnv();
