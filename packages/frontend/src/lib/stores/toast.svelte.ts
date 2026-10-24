import { ApiError } from '$lib/api';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
}

class ToastStore {
	items: Toast[] = $state([]);
	#next = 1;

	push(message: string, kind: ToastKind = 'info', ms = kind === 'error' ? 6000 : 3500) {
		const id = this.#next++;
		this.items.push({ id, kind, message });
		setTimeout(() => this.dismiss(id), ms);
		return id;
	}

	success(message: string) {
		return this.push(message, 'success');
	}

	error(message: string) {
		return this.push(message, 'error');
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new ToastStore();

export function errorMessage(err: unknown): string {
	if (err instanceof ApiError) return err.status ? err.message : 'Cannot reach the server';
	if (err instanceof Error) return err.message;
	return 'Something went wrong';
}

/** Show any error as a toast. Use as `.catch(handleError)` or in try/catch. */
export function handleError(err: unknown): void {
	console.error(err);
	toasts.error(errorMessage(err));
}
