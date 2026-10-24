import { auth, type Fetch } from '$lib/api';
import { wsStore } from '$lib/stores/websocket.svelte';
import { hasRole, type MeDTO, type Role } from 'common';

const anonymous: MeDTO = { user: null, participations: [] };

class SessionStore {
	me: MeDTO = $state(anonymous);
	loaded = $state(false);
	#pending: Promise<MeDTO> | null = null;

	get user() {
		return this.me.user;
	}

	is(role: Role): boolean {
		return hasRole(this.me.user?.role, role);
	}

	/** Load once (used by the root load function); later calls reuse the cached value. */
	ensure(fetch?: Fetch): Promise<MeDTO> {
		if (this.loaded) return Promise.resolve(this.me);
		return (this.#pending ??= this.#fetch(fetch));
	}

	/** Re-read `/api/auth/me` and reconnect the WS so the server sees the new cookie. */
	async refresh(): Promise<MeDTO> {
		this.#pending = this.#fetch();
		const me = await this.#pending;
		wsStore.reconnect();
		return me;
	}

	async login(email: string, password: string): Promise<MeDTO> {
		await auth.login({ email, password });
		return this.refresh();
	}

	async logout(): Promise<void> {
		try {
			await auth.logout();
		} finally {
			await this.refresh();
		}
	}

	async #fetch(fetch?: Fetch): Promise<MeDTO> {
		try {
			this.me = await auth.me(fetch);
		} catch {
			this.me = anonymous;
		} finally {
			this.loaded = true;
			this.#pending = null;
		}
		return this.me;
	}
}

export const session = new SessionStore();
