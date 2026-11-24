<script lang="ts">
	import type { ProjectDTO } from 'common';
	import { ExternalLink, FileText } from '@lucide/svelte';
	import { attendee } from '$lib/api';

	interface Props {
		project: Pick<ProjectDTO, 'id' | 'link' | 'deckSize'>;
		class?: string;
	}

	let { project, class: className = '' }: Props = $props();

	/** Shown so people can see where a link goes before they tap it. */
	const host = $derived.by(() => {
		try {
			return project.link ? new URL(project.link).host.replace(/^www\./, '') : null;
		} catch {
			return null;
		}
	});
	const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;
</script>

{#if project.link || project.deckSize}
	<span class={['flex flex-wrap items-center gap-1.5', className]}>
		{#if project.link && host}
			<a
				class="btn btn-outline normal-case btn-xs"
				href={project.link}
				target="_blank"
				rel="noopener noreferrer nofollow"
				title={project.link}
			>
				<ExternalLink size={12} /><span class="max-w-[14ch] truncate font-mono">{host}</span>
			</a>
		{/if}
		{#if project.deckSize}
			<a
				class="btn btn-outline btn-xs"
				href={attendee.deckUrl(project.id)}
				target="_blank"
				rel="noopener noreferrer"
				title="Presentation PDF · {mb(project.deckSize)}"
			>
				<FileText size={12} /><span class="font-mono">Slides</span>
			</a>
		{/if}
	</span>
{/if}
