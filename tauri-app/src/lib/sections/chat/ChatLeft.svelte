<script lang="ts">
  import { onMount } from 'svelte';
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { getChats } from '$lib/status/api';
  import { statusState } from '$lib/stores/statusStore.svelte';

  let {
    onSelectChat,
    selectedChatId = $bindable(null)
  }: {
    onSelectChat: (chatId: string) => void;
    selectedChatId: string | null;
  } = $props();

  let chats = $state<any[]>([]);
  let isLoading = $state(true);

  onMount(async () => {
    if (!statusState.backendPort) return;
    try {
      const result = await getChats(statusState.backendPort);
      chats = result.result || [];
    } catch (e) {
      console.error("Failed to load chats:", e);
    } finally {
      isLoading = false;
    }
  });

  function selectChat(chatId: string) {
    selectedChatId = chatId;
    onSelectChat(chatId);
  }
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border font-bold text-lg text-primary">{i18n.t('Chat')}</div>

  <ScrollArea class="flex-1">
    {#if isLoading}
      <p class="p-4 text-muted-foreground text-sm">{i18n.t('Loading chats...')}</p>
    {:else if chats.length === 0}
      <p class="p-4 text-muted-foreground text-sm">{i18n.t('No chats yet')}</p>
    {:else}
      <div class="p-2 space-y-1">
        {#each chats as chat}
          <button
            onclick={() => selectChat(chat.id)}
            class="w-full text-left p-3 rounded-md hover:bg-secondary transition-colors {selectedChatId === chat.id ? 'bg-secondary' : ''}"
          >
            <div class="font-medium text-foreground">{chat.name || chat.id.slice(0, 8)}</div>
            <div class="text-xs text-muted-foreground">{chat.lastMessage?.text || ''}</div>
          </button>
        {/each}
      </div>
    {/if}
  </ScrollArea>
</div>
