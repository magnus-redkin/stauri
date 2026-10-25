<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { getChatMessages, sendChatMessage, acceptContactRequest } from '$lib/status/api';
  import { statusState } from '$lib/stores/statusStore.svelte';
  import type { ChatItem } from './ChatLeft.svelte';

  import { formatMessageText } from '$lib/utils/user';

  let {
    chat, contacts = [],
    onBack, onRefresh
  }: {
    chat: ChatItem | null;
    contacts?: any[];
    onBack?: () => void;
    onRefresh?: () => void;
  } = $props();

  let messages = $state<any[]>([]);
  let inputText = $state('');
  let isLoading = $state(false);
  let isAccepting = $state(false);

  // Загружаем историю при смене чата (только для обычных Status-чатов)
  $effect(() => {
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

  $effect(() => {
    if (!chat || chat.isPendingRequest || !statusState.backendPort) return;
    // Перезагружаем историю при новом сигнале
    if (statusState.lastMessageSignal > 0) {
      getChatMessages(statusState.backendPort, chat.id)
        .then(res => { messages = res.result?.messages || []; })
        .catch(console.error);
    }
  });

  // Отправка сообщения
  async function send() {
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

  // Принятие запроса в контакты
  async function acceptRequest() {
    if (!chat || !statusState.backendPort) return;
    isAccepting = true;
    try {
      await acceptContactRequest(statusState.backendPort, chat.id);
      if (onRefresh) await onRefresh();
    } catch (e: any) {
      console.error("Failed to accept request:", e);
      statusState.errorMsg = `Failed to accept request: ${e.message || e}`;
    } finally {
      isAccepting = false;
    }
  }

  // Отклонение запроса (пока заглушка)
  async function declineRequest() {
    alert("Decline is not yet implemented.");
  }
</script>

<div class="h-full flex flex-col bg-card">
  {#if !chat}
    <div class="flex items-center justify-center h-full text-muted-foreground">
      {i18n.t('Select a chat')}
    </div>
  {:else}
    <!-- Заголовок чата: имя (alias/displayName) вместо ключа -->
    <div class="p-4 border-b border-border flex items-center gap-2">
      {#if onBack}
        <button onclick={onBack} class="md:hidden text-muted-foreground">
          ←
        </button>
      {/if}
      <span class="font-bold text-primary truncate">
        {chat.name || i18n.t('Unknown')}
      </span>
      {#if chat.type === 'external'}
        <span class="text-xs bg-secondary px-2 py-0.5 rounded text-muted-foreground">{chat.source?.toUpperCase()}</span>
      {:else if chat.isPendingRequest}
        <span class="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded">{i18n.t('Contact Request')}</span>
      {/if}
    </div>

    <!-- Основная область -->
    {#if chat.isPendingRequest}
      <!-- Экран запроса в контакты -->
      <div class="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <div class="w-16 h-16 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-3xl">!</div>

        <div class="text-center space-y-2 max-w-md">
          <h3 class="text-lg font-bold text-foreground">{i18n.t('Contact Request')}</h3>
          <p class="text-sm text-muted-foreground">
            {i18n.t('User')} <strong>{chat.name || i18n.t('Unknown')}</strong> {i18n.t('wants to connect with you.')}
          </p>

          <!-- Текст сообщения запроса -->
          {#if chat.lastMessage}
            <div class="mt-4 p-3 bg-secondary rounded-lg border border-border">
              <p class="text-xs text-muted-foreground mb-1 font-semibold">{i18n.t('Message:')}</p>
              <p class="text-sm text-foreground italic">"{chat.lastMessage}"</p>
            </div>
          {/if}

          <!-- Публичный ключ (для продвинутых) -->
          <div class="mt-2">
            <p class="text-[10px] font-bold text-muted-foreground uppercase mb-1">{i18n.t('Public Key')}</p>
            <div class="font-mono text-xs bg-secondary p-2 rounded break-all text-muted-foreground">
              {chat.id}
            </div>
          </div>
        </div>

        <!-- Кнопки -->
        <div class="flex gap-3 w-full max-w-md">
          <button
            onclick={acceptRequest}
            disabled={isAccepting}
            class="flex-1 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {isAccepting ? i18n.t('Accepting...') : i18n.t('Accept')}
          </button>
          <button
            onclick={declineRequest}
            class="flex-1 py-2 border border-border rounded-md text-sm font-medium hover:bg-secondary transition"
          >
            {i18n.t('Decline')}
          </button>
        </div>
      </div>

    {:else if chat.type === 'status'}
      <!-- Обычный Status-чат -->
      <ScrollArea class="flex-1 p-4">
        {#if isLoading}
          <p class="text-muted-foreground text-sm">{i18n.t('Loading messages...')}</p>
        {:else if messages.length === 0}
          <p class="text-muted-foreground text-sm italic">{i18n.t('No messages yet. Say hello!')}</p>
        {:else}
          <div class="space-y-2">
            {#each messages as msg}
              <div class="flex {msg.from === 'me' ? 'justify-end' : 'justify-start'}">
                <div class="max-w-[70%] p-2 rounded-lg {msg.from === 'me' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}">
                  {formatMessageText(msg.text, contacts)}
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

    {:else}
      <!-- Внешний чат -->
      <div class="flex-1 flex items-center justify-center p-6">
        <div class="text-center space-y-2">
          <p class="text-muted-foreground text-sm">
            {i18n.t('This is a read-only external channel.')}
          </p>
        </div>
      </div>
    {/if}
  {/if}
</div>
