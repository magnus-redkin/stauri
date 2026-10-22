<script lang="ts">
  import { i18n } from '$lib/i18n';

  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

  const contacts = [
    { id: "1", name: "Alice", key: "0x123..." },
    { id: "2", name: "Bob", key: "0x456..." },
  ];
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border font-bold text-lg text-primary">{i18n.t('Contacts')}</div>
  <ScrollArea class="flex-1">
    <div class="p-2 space-y-1">
      {#each contacts as contact}
        <button class="w-full text-left p-3 rounded-md hover:bg-secondary flex flex-col transition-colors border border-transparent hover:border-border">
          <span class="font-medium text-foreground">{contact.name}</span>
          <span class="text-xs text-muted-foreground font-mono mt-1">{contact.key}</span>
        </button>
      {/each}
    </div>
  </ScrollArea>
</div>
