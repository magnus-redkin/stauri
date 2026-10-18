<script lang="ts">
  // Пропсы (в Svelte 5 они объявляются через $props)
  let { messages = [] }: { messages: string[] } = $props();

  // Функция для форматирования JSON-строк в читаемый вид
  function formatMessage(rawMsg: string) {
    try {
      const parsed = JSON.parse(rawMsg);
      // Если это сигнал о новом сообщении, показываем текст
      if (parsed.type === "messages.new" && parsed.event?.messages) {
        return parsed.event.messages.map((m: any) => `[${m.from}] ${m.text}`).join('\n');
      }
      // Иначе показываем тип события и время
      return `${parsed.type} (${new Date(parsed.timestamp * 1000).toLocaleTimeString()})`;
    } catch {
      return rawMsg; // Если не JSON, возвращаем как есть
    }
  }
</script>

<div class="w-full bg-white dark:bg-gray-800 rounded-lg shadow p-4">
  <h2 class="text-xl font-bold mb-4 border-b pb-2 dark:border-gray-700">Chat & Signals</h2>

  {#if messages.length === 0}
    <p class="text-gray-500 italic text-center py-4">Waiting for messages...</p>
  {:else}
    <div class="flex flex-col gap-2 max-h-[500px] overflow-y-auto">
      {#each messages as msg, index}
        <div class="p-2 bg-gray-100 dark:bg-gray-700 rounded text-sm font-mono break-all">
          {formatMessage(msg)}
        </div>
      {/each}
    </div>
  {/if}
</div>
