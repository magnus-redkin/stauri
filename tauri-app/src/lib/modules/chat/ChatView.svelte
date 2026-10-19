<script lang="ts">
  import type { StatusEvent, MessagesNewEvent } from '$lib/status/types';

  let { events = [] }: { events: StatusEvent[] } = $props();

  // Функция для форматирования события
  function formatEvent(event: StatusEvent) {
    const time = event.timestamp
      ? new Date(event.timestamp * 1000).toLocaleTimeString()
      : '--:--:--';

    // Если это сообщение, показываем текст и отправителя
    if (event.type === 'messages.new') {
      const msgEvent = event as MessagesNewEvent;
      const messages = msgEvent.event?.messages || [];

      if (messages.length === 0) {
        return `${time} [messages.new] (empty batch)`;
      }

      return messages.map(m =>
        `${time} [${m.from.substring(0, 8)}...] ${m.text}`
      ).join('\n');
    }

    // Для всех остальных событий показываем только тип
    return `${time} ${event.type}`;
  }

  // Фильтруем: показываем сообщения и важные системные события (опционально)
  const displayEvents = $derived(
    events.filter(e =>
      e.type === 'messages.new' ||
      e.type === 'node.login' ||
      e.type === 'node.ready'
    )
  );
</script>

<div class="w-full bg-white dark:bg-gray-800 rounded-lg shadow p-4">
  <h2 class="text-xl font-bold mb-4 border-b pb-2 dark:border-gray-700">
    Chat & Signals
    <span class="text-sm font-normal text-gray-500 ml-2">
      ({displayEvents.length} events)
    </span>
  </h2>

  {#if displayEvents.length === 0}
    <p class="text-gray-500 italic text-center py-4">Waiting for messages...</p>
  {:else}
    <div class="flex flex-col gap-2 max-h-[500px] overflow-y-auto">
      {#each displayEvents as event, index (event.timestamp + '-' + index)}
        <div class="p-2 bg-gray-100 dark:bg-gray-700 rounded text-sm font-mono whitespace-pre-wrap break-words">
          {formatEvent(event)}
        </div>
      {/each}
    </div>
  {/if}
</div>
