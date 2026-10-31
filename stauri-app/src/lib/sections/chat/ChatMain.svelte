<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { getChatMessages, sendChatMessage, acceptContactRequest } from '$lib/status/api';
  import { statusState } from '$lib/stores/statusStore.svelte';
  import { chatsState, loadChats } from '$lib/stores/chatsStore.svelte';
  import { formatMessageText } from '$lib/utils/user';
  import type { ChatItem } from './ChatLeft.svelte';

  let messages = $state<any[]>([]);
  let inputText = $state('');
  let isLoading = $state(false);
  let isAccepting = $state(false);

  // Загружаем историю при смене чата
  $effect(() => {
    const chat = chatsState.selected;
    if (!chat || chat.isPendingRequest || chat.type !== 'status' || !statusState.backendPort) {
      messages = [];
      return;
    }
    isLoading = true;
    messages = [];

    getChatMessages(statusState.backendPort, chat.id)
      .then(res => {
        messages = res.result?.messages || [];
      })
      .catch(console.error)
      .finally(() => isLoading = false);
  });

  async function send() {
    const chat = chatsState.selected;
    if (!inputText.trim() || !chat || chat.isPendingRequest || chat.type !== 'status' || !statusState.backendPort) return;
    const text = inputText;
    inputText = '';
    try {
      await sendChatMessage(statusState.backendPort, chat.id, text);
      messages = [...messages, { text, from: 'me', timestamp: Date.now() }];
    } catch (e) {
      console.error("Send failed:", e);
      statusState.errorMsg = "Failed to send message";
    }
  }

  async function acceptRequest() {
    const chat = chatsState.selected;
    if (!chat || !statusState.backendPort) return;
    isAccepting = true;
    try {
      await acceptContactRequest(statusState.backendPort, chat.id);
      await loadChats(true); // Перезагружаем чаты
    } catch (e: any) {
      statusState.errorMsg = `Failed to accept request: ${e.message || e}`;
    } finally {
      isAccepting = false;
    }
  }
</script>

<div class="h-full flex flex-col bg-card">
  {#if !chatsState.selected}
    <div class="flex items-center justify-center h-full text-muted-foreground">
      {i18n.t('Select a chat')}
    </div>
  {:else}
    <!-- Заголовок -->
    <div class="p-4 border-b border-border flex items-center gap-2">
      <span class="font-bold text-primary truncate">{chatsState.selected.name}</span>
      {#if chatsState.selected.isPendingRequest}
        <span class="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded">{i18n.t('Contact Request')}</span>
      {/if}
    </div>

    {#if chatsState.selected.isPendingRequest}
      <!-- Экран запроса -->
      <div class="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <div class="w-16 h-16 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-3xl">!</div>
        <p class="text-center text-sm text-muted-foreground">"{chatsState.selected.lastMessage}"</p>
        <div class="flex gap-3">
          <button onclick={acceptRequest} disabled={isAccepting} class="px-4 py-2 bg-primary text-primary-foreground rounded-md">
            {isAccepting ? i18n.t('Accepting...') : i18n.t('Accept')}
          </button>
        </div>
      </div>
    {:else}
      <!-- История -->
      <ScrollArea class="flex-1 p-4">
        {#if isLoading}
          <p class="text-muted-foreground text-sm">{i18n.t('Loading messages...')}</p>
        {:else if messages.length === 0}
          <p class="text-muted-foreground text-sm italic">{i18n.t('No messages yet.')}</p>
        {:else}
          <div class="space-y-2">
            {#each messages as msg, i (i)}
              <div class="flex {msg.from === 'me' ? 'justify-end' : 'justify-start'}">
                <div class="max-w-[70%] p-2 rounded-lg {msg.from === 'me' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}">
                  {formatMessageText(msg.text, chatsState.contacts)}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </ScrollArea>

      <!-- Ввод -->
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
  {/if}
</div>
