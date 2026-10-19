<script lang="ts">
  import type { StatusEvent } from '$lib/status/types';

  let { events = [] }: { events: StatusEvent[] } = $props();

  function formatEvent(event: StatusEvent) {
    const time = event.timestamp ? new Date(event.timestamp * 1000).toLocaleTimeString() : 'unknown';
    return `${event.type} (${time})`;
  }
</script>

<div class="w-full bg-white dark:bg-gray-800 rounded-lg shadow p-4">
  <h2 class="text-xl font-bold mb-4 border-b pb-2 dark:border-gray-700">Chat & Signals</h2>

  {#if events.length === 0}
    <p class="text-gray-500 italic text-center py-4">Waiting for messages...</p>
  {:else}
    <div class="flex flex-col gap-2 max-h-[500px] overflow-y-auto">
      {#each events as event, index (event.timestamp + '-' + index)}
        <div class="p-2 bg-gray-100 dark:bg-gray-700 rounded text-sm font-mono break-all">
          {formatEvent(event)}
        </div>
      {/each}
    </div>
  {/if}
</div>
