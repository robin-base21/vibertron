<script lang="ts">
	import Blueprint from '$lib/blueprint/Blueprint.svelte';
	import { fixtureBlueprint, fixtureTeams } from '$lib/blueprint/fixtures';
</script>

<div class="flex flex-col gap-4 p-4">
	<Blueprint blueprint={fixtureBlueprint} highlightSegmentId="seg_lab" class="w-full max-w-5xl border border-white/20" />
	<Blueprint blueprint={fixtureBlueprint} teams={fixtureTeams} highlightStationId="seg_hall_a-06" class="w-full max-w-5xl" />
	<Blueprint blueprint={fixtureBlueprint} invert class="w-full max-w-md" />
</div>
