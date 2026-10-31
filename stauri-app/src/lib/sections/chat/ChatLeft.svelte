<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { chatsState, setSelectedChat } from '$lib/stores/chatsStore.svelte';

  let { onSelectChat }: { onSelectChat?: (chat: ChatItem) => void } = $props();

  let searchQuery = $state('');

  export type ChatItem = {
    id: string;
    name: string;
    lastMessage: string;
    type: 'status' | 'external';
    isPendingRequest?: boolean;
    source?: 'rss' | 'telegram';
  };

  const filteredItems = $derived(
    chatsState.items.filter(i =>
      i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.id.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  function select(item: ChatItem) {
    setSelectedChat(item);
    onSelectChat?.(item);
  }
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border flex justify-between items-center">
    <span class="font-bold text-lg text-primary">{i18n.t('Chat')}</span>
  </div>

  <div class="p-2 border-b border-border">
    <input
      bind:value={searchQuery}
      placeholder={i18n.t('Search chats')}
      class="w-full h-9 border border-input rounded-md px-3 text-sm bg-background"
    />
  </div>

  <ScrollArea class="flex-1">
    {#if chatsState.isLoading}
      <p class="p-4 text-muted-foreground text-sm">{i18n.t('Loading chats...')}</p>
    {:else if filteredItems.length === 0}
      <p class="p-4 text-muted-foreground text-sm italic">{i18n.t('No chats yet')}</p>
    {:else}
      <div class="p-2 space-y-1">
        {#each filteredItems as item (item.id)}
          <button
            onclick={() => select(item)}
            class="w-full text-left p-3 rounded-md hover:bg-secondary transition-colors {chatsState.selected?.id === item.id ? 'bg-secondary' : ''}"
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
                  📡
                </div>
              {/if}
              <div class="flex-1 min-w-0">
                <div class="font-medium text-foreground truncate">{item.name || item.id.slice(0, 8)}</div>
                <div class="text-xs text-muted-foreground truncate">{item.lastMessage || ''}</div>
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </ScrollArea>
</div>
