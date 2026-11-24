import { env } from '$env/dynamic/private';

/** Server config (repo-root .env in dev). */
export const siteEnv = {
	get databasePath() {
		return env.SITE_DATABASE_PATH || './data/site.sqlite';
	},
	get dataDir() {
		return env.SITE_DATA_DIR || './data';
	},
	/** Admin area password; the admin area is disabled while it is empty. */
	get adminPassword() {
		return env.SITE_ADMIN_PASSWORD ?? '';
	},
	/** Shared with Vibertron (SITE_PUBLISH_SECRET there) to verify pushed results. */
	get publishSecret() {
		return env.SITE_PUBLISH_SECRET ?? '';
	},
	/** Resend API key. Empty: emails are only logged (admin → Emails shows them). */
	get resendKey() {
		return env.RESEND_API_KEY ?? '';
	},
	/** Sender, e.g. "OurBusan.vibe <hello@mail.base21.space>" (its domain verified in Resend). */
	get mailFrom() {
		return env.SITE_MAIL_FROM || 'OurBusan.vibe <hello@mail.base21.space>';
	},
	/** Where the site tells the organisers about cancellations (falls back to the reply-to address). */
	get adminEmail() {
		const raw = env.SITE_ADMIN_EMAIL || env.SITE_MAIL_REPLY_TO || '';
		return /<([^>]+)>/.exec(raw)?.[1] ?? raw.trim();
	},
	/** Optional address replies go to. */
	get mailReplyTo() {
		return env.SITE_MAIL_REPLY_TO ?? '';
	},
	/**
	 * AI provider for "Fill out with AI" and flyers: openrouter (default; key shared with the event
	 * app) or ppq. Without its key the AI buttons are hidden.
	 */
	get aiProvider(): 'openrouter' | 'ppq' {
		const p = env.SITE_AI_PROVIDER?.toLowerCase();
		if (p === 'ppq' || p === 'openrouter') return p;
		return !env.OPENROUTER_API_KEY && env.PPQ_API_KEY ? 'ppq' : 'openrouter';
	},
	get aiKey() {
		return (this.aiProvider === 'ppq' ? env.PPQ_API_KEY : env.OPENROUTER_API_KEY) ?? '';
	},
	/** Writes event fields. */
	get aiTextModel() {
		return (
			env.SITE_AI_TEXT_MODEL ||
			(this.aiProvider === 'ppq' ? 'claude-sonnet-5.5' : 'anthropic/claude-sonnet-5.5')
		);
	},
	/** Draws flyers (must take a reference image). */
	get aiImageModel() {
		return (
			env.SITE_AI_IMAGE_MODEL ||
			(this.aiProvider === 'ppq' ? 'nano-banana-pro' : 'google/gemini-3-pro-image')
		);
	},
	/** The public site address printed on flyers (ORIGIN in production; never localhost). */
	get publicHost() {
		try {
			const host = new URL(env.ORIGIN ?? '').host;
			if (host && !/^(localhost|127\.|\[::1\])/.test(host)) return host;
		} catch {
			/* fallback */
		}
		return 'vibe.ourbusan.life';
	},
	get secureCookies() {
		return env.COOKIE_SECURE === 'true';
	}
};
