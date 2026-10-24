<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { getChatMessages, sendChatMessage } from '$lib/status/api';
  import { statusState } from '$lib/stores/statusStore.svelte';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';

  let {
    chatId
  }: {
    chatId: string | null;
  } = $props();

  let messages = $state<any[]>([]);
  let inputText = $state('');
  let isLoading = $state(false);

  // Загружаем историю при выборе чата
  $effect(() => {
    if (!chatId || !statusState.backendPort) return;
    isLoading = true;
    getChatMessages(statusState.backendPort, chatId)
      .then(res => {
        messages = res.result?.messages || [];
      })
      .catch(console.error)
      .finally(() => isLoading = false);
  });

  // Отправка сообщения
  async function send() {
    if (!inputText.trim() || !chatId || !statusState.backendPort) return;
    const text = inputText;
    inputText = '';
    try {
      await sendChatMessage(statusState.backendPort, chatId, text);
      // Добавляем локально (или ждем WebSocket)
      messages = [...messages, { text, from: 'me', timestamp: Date.now() }];
    } catch (e) {
      console.error("Send failed:", e);
      statusState.errorMsg = "Failed to send message";
    }
  }
</script>

<div class="h-full flex flex-col bg-card">
  {#if !chatId}
    <div class="flex items-center justify-center h-full text-muted-foreground">
      {i18n.t('Select a chat')}
    </div>
  {:else}
    <!-- Заголовок чата -->
    <div class="p-4 border-b border-border font-bold text-primary">{chatId.slice(0, 8)}...</div>

    <!-- История сообщений -->
    <ScrollArea class="flex-1 p-4">
      {#if isLoading}
        <p class="text-muted-foreground">{i18n.t('Loading messages...')}</p>
      {:else}
        <div class="space-y-2">
          {#each messages as msg}
            <div class="flex {msg.from === 'me' ? 'justify-end' : 'justify-start'}">
              <div class="max-w-[70%] p-2 rounded-lg {msg.from === 'me' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}">
                {msg.text}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </ScrollArea>

    <!-- Поле ввода -->
    <div class="p-4 border-t border-border flex gap-2">
      <input
        bind:value={inputText}
        placeholder={i18n.t('Type a message...')}
        onkeydown={(e) => { if (e.key === 'Enter') send(); }}
        class="flex-1 px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <button onclick={send} class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
        {i18n.t('Send')}
      </button>
    </div>
  {/if}
</div>
