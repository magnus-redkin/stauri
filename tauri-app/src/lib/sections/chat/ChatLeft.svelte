<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';

  export type ChatItem = {
    id: string;
    name: string;
    lastMessage: string;
    type: 'status' | 'external';
    isPendingRequest?: boolean; // <-- Новое поле
    source?: 'rss' | 'telegram';
  };

  let {
    items = [],
    selectedChatId = null,
    onSelectChat
  }: {
    items: ChatItem[];
    selectedChatId: string | null;
    onSelectChat: (item: ChatItem) => void;
  } = $props();

  function select(item: ChatItem) {
    onSelectChat(item);
  }
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border flex justify-between items-center">
    <span class="font-bold text-lg text-primary">{i18n.t('Chat')}</span>
  </div>

  <ScrollArea class="flex-1">
    {#if items.length === 0}
      <p class="p-4 text-muted-foreground text-sm text-center italic">{i18n.t('No chats yet')}</p>
    {:else}
      <div class="p-2 space-y-1">
        {#each items as item (item.id)}
          <button
            onclick={() => select(item)}
            class="w-full text-left p-3 rounded-md hover:bg-secondary transition-colors {selectedChatId === item.id ? 'bg-secondary' : ''}"
          >
            <div class="flex items-center gap-2">
              {#if item.isPendingRequest}
                <div class="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-lg">!</div>
              {:else if item.type === 'status'}
                <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                  {item.name ? item.name.substring(0, 1).toUpperCase() : '#'}
                </div>
              {:else}
                <div class="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"></path><path d="M4 4a16 16 0 0 1 16 16"></path><circle cx="5" cy="19" r="1"></circle></svg>
                </div>
              {/if}
              <div class="flex-1 min-w-0">
                <div class="font-medium text-foreground truncate">
                  {item.name || item.id.slice(0, 8)}
                  {#if item.isPendingRequest}
                    <span class="ml-2 text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded">{i18n.t('Request')}</span>
                  {/if}
                </div>
                <div class="text-xs text-muted-foreground truncate">{item.lastMessage || ''}</div>
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </ScrollArea>
</div>
