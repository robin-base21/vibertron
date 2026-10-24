<script lang="ts">
	import { admin } from '$lib/api';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { session } from '$lib/stores/session.svelte';
	import { handleError, toasts } from '$lib/stores/toast.svelte';
	import { Role, type UserDTO } from 'common';
	import { Trash2 } from '@lucide/svelte';

	let { data } = $props();

	let users = $derived(data.users);
	const events = $derived([...data.events].sort((a, b) => b.createdAt - a.createdAt));
	const managerName = $derived(new Map(users.map((u) => [u.id, u.displayName])));

	const ROLE_ORDER: Record<string, number> = { admin: 0, manager: 1, attendee: 2 };
	const sortedUsers = $derived(
		[...users].sort(
			(a, b) =>
				ROLE_ORDER[a.role]! - ROLE_ORDER[b.role]! || a.displayName.localeCompare(b.displayName)
		)
	);
	let showAttendees = $state(false);
	const visibleUsers = $derived(
		showAttendees ? sortedUsers : sortedUsers.filter((u) => u.role !== 'attendee')
	);
	const attendeeCount = $derived(users.filter((u) => u.role === 'attendee').length);

	// ----- create -----
	let form = $state({
		email: '',
		displayName: '',
		password: '',
		role: 'manager' as 'manager' | 'admin'
	});
	let creating = $state(false);

	async function create(e: SubmitEvent) {
		e.preventDefault();
		creating = true;
		try {
			const { user } = await admin.createUser(form);
			users = [...users, user];
			toasts.success(`Created ${user.displayName}`);
			form = { email: '', displayName: '', password: '', role: 'manager' };
		} catch (err) {
			handleError(err);
		} finally {
			creating = false;
		}
	}

	// ----- edit -----
	function replace(user: UserDTO) {
		users = users.map((u) => (u.id === user.id ? user : u));
	}

	async function setRole(u: UserDTO, role: Role) {
		if (role === u.role) return;
		try {
			replace((await admin.updateUser(u.id, { role })).user);
			toasts.success(`${u.displayName} is now ${role}`);
		} catch (err) {
			handleError(err);
			replace({ ...u }); // reset the select
		}
	}

	let resetFor = $state<string | null>(null);
	let newPassword = $state('');

	async function resetPassword(e: SubmitEvent, u: UserDTO) {
		e.preventDefault();
		try {
			await admin.updateUser(u.id, { password: newPassword });
			toasts.success(`Password reset for ${u.displayName}`);
			resetFor = null;
			newPassword = '';
		} catch (err) {
			handleError(err);
		}
	}

	async function remove(u: UserDTO) {
		if (!confirm(`Delete ${u.displayName}${u.email ? ` (${u.email})` : ''}?`)) return;
		try {
			await admin.deleteUser(u.id);
			users = users.filter((x) => x.id !== u.id);
			toasts.success(`Deleted ${u.displayName}`);
		} catch (err) {
			handleError(err);
		}
	}
</script>

<svelte:head><title>Admin · Vibertron</title></svelte:head>

<main class="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-8">
	<h1 class="bp-label text-4xl font-semibold">Admin</h1>

	<section class="flex flex-col gap-3">
		<div class="flex items-baseline justify-between gap-4">
			<h2 class="bp-label text-xl">Users</h2>
			<label class="flex items-center gap-2 font-mono text-xs opacity-70">
				<input type="checkbox" class="checkbox checkbox-xs" bind:checked={showAttendees} />
				Show attendees ({attendeeCount})
			</label>
		</div>

		<form
			class="grid gap-3 border border-bp-line/40 p-4 md:grid-cols-[1fr_1fr_1fr_8rem_auto] md:items-end"
			onsubmit={create}
		>
			<label class="flex flex-col gap-1">
				<span class="bp-label text-xs opacity-70">Email</span>
				<input class="input w-full font-mono" type="email" required bind:value={form.email} />
			</label>
			<label class="flex flex-col gap-1">
				<span class="bp-label text-xs opacity-70">Display name</span>
				<input class="input w-full" required maxlength="60" bind:value={form.displayName} />
			</label>
			<label class="flex flex-col gap-1">
				<span class="bp-label text-xs opacity-70">Password (min 8)</span>
				<input
					class="input w-full font-mono"
					type="password"
					autocomplete="new-password"
					minlength="8"
					required
					bind:value={form.password}
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span class="bp-label text-xs opacity-70">Role</span>
				<select class="select w-full bp-label" bind:value={form.role}>
					<option value="manager">Manager</option>
					<option value="admin">Admin</option>
				</select>
			</label>
			<button class="btn bp-label btn-primary" disabled={creating}>Create user</button>
		</form>

		<div class="overflow-x-auto border border-bp-line/40">
			<table class="table">
				<thead>
					<tr class="bp-label">
						<th>Name</th>
						<th>Email</th>
						<th>Role</th>
						<th class="text-right">Created</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each visibleUsers as u (u.id)}
						{@const self = u.id === session.user?.id}
						<tr>
							<td class="text-base">{u.displayName}{self ? ' (you)' : ''}</td>
							<td class="font-mono text-xs opacity-70">{u.email ?? '—'}</td>
							<td>
								<select
									class="select w-32 bp-label select-sm"
									value={u.role}
									disabled={self}
									onchange={(e) => setRole(u, e.currentTarget.value as Role)}
								>
									{#each Role.options as r (r)}
										<option value={r}>{r}</option>
									{/each}
								</select>
							</td>
							<td class="text-right font-mono text-xs opacity-70"
								>{new Date(u.createdAt).toLocaleDateString()}</td
							>
							<td class="w-0">
								<div class="flex justify-end gap-1">
									{#if u.email}
										<button
											class="btn btn-ghost bp-label btn-xs"
											onclick={() => {
												resetFor = resetFor === u.id ? null : u.id;
												newPassword = '';
											}}
										>
											Reset password
										</button>
									{/if}
									<button
										class="btn btn-ghost btn-xs"
										disabled={self}
										aria-label="Delete {u.displayName}"
										title="Delete"
										onclick={() => remove(u)}
									>
										<Trash2 size={14} />
									</button>
								</div>
							</td>
						</tr>
						{#if resetFor === u.id}
							<tr>
								<td colspan="5">
									<form
										class="flex items-center justify-end gap-2"
										onsubmit={(e) => resetPassword(e, u)}
									>
										<span class="bp-label text-xs opacity-70">New password for {u.displayName}</span
										>
										<input
											class="input w-64 font-mono input-sm"
											type="password"
											autocomplete="new-password"
											minlength="8"
											required
											bind:value={newPassword}
										/>
										<button
											class="btn bp-label btn-primary btn-sm"
											disabled={newPassword.length < 8}>Save</button
										>
										<button
											type="button"
											class="btn btn-ghost bp-label btn-sm"
											onclick={() => (resetFor = null)}
										>
											Cancel
										</button>
									</form>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="flex flex-col gap-3">
		<h2 class="bp-label text-xl">All events</h2>
		{#if events.length === 0}
			<div class="border border-dashed border-bp-line/40 p-8 text-center">
				<p class="bp-label opacity-60">No events yet</p>
			</div>
		{:else}
			<div class="overflow-x-auto border border-bp-line/40">
				<table class="table">
					<thead>
						<tr class="bp-label">
							<th>Name</th>
							<th>Manager</th>
							<th>Status</th>
							<th class="text-right">Participants</th>
							<th class="text-right">Created</th>
						</tr>
					</thead>
					<tbody>
						{#each events as ev (ev.id)}
							<tr class="hover:bg-base-200">
								<td
									><a class="bp-label text-lg hover:underline" href="/manage/{ev.id}">{ev.name}</a
									></td
								>
								<td class="text-sm opacity-80">{managerName.get(ev.managerId) ?? ev.managerId}</td>
								<td><StatusBadge status={ev.status} /></td>
								<td class="text-right font-mono">{ev.participantCount}</td>
								<td class="text-right font-mono text-xs opacity-70"
									>{new Date(ev.createdAt).toLocaleDateString()}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</main>
