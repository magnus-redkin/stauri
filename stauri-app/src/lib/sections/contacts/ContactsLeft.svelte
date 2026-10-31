<script lang="ts">
  import { onMount } from 'svelte';
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { contactsState, loadContacts, selectContact, acceptRequest } from '$lib/stores/contactsStore.svelte';
  import { statusState } from '$lib/stores/statusStore.svelte';
  import { getDisplayName } from '$lib/utils/user';

  // Теперь пропсов для данных нет, только для навигации (если нужно)
  let { onOpenChat }: { onOpenChat?: (chatId: string) => void } = $props();

  let searchQuery = $state('');

  const filteredContacts = $derived(
    contactsState.items.filter(c =>
      getDisplayName(c).toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  onMount(() => loadContacts());
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border flex justify-between items-center">
    <span class="font-bold text-lg text-primary">{i18n.t('Contacts')}</span>
    <button onclick={() => selectContact(null)} class="text-muted-foreground hover:text-primary" title={i18n.t('Add Contact')}>
      + {"Иконка Add Contact"}
    </button>
  </div>

  <div class="p-2 border-b border-border">
    <input bind:value={searchQuery} placeholder={i18n.t('Search by name or key')} class="w-full h-9 border border-input rounded-md px-3 text-sm bg-background" />
  </div>

  <ScrollArea class="flex-1">
    {#if contactsState.isLoading}
      <p class="p-4 text-muted-foreground text-sm">{i18n.t('Loading contacts...')}</p>
    {:else if filteredContacts.length === 0}
      <p class="p-4 text-muted-foreground text-sm italic">{i18n.t('No contacts found')}</p>
    {:else}
      <div class="p-2 space-y-1">
        {#each filteredContacts as contact (contact.id)}
          <div
            role="button"
            tabindex="0"
            onclick={() => selectContact(contact)}
            onkeydown={(e) => { if (e.key === 'Enter') selectContact(contact); }}
            class="w-full text-left p-3 rounded-md hover:bg-secondary transition-colors flex items-center justify-between gap-2 cursor-pointer {contactsState.selected?.id === contact.id ? 'bg-secondary' : ''}"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                {getDisplayName(contact).substring(0, 1).toUpperCase()}
              </div>
              <div class="min-w-0">
                <div class="font-medium truncate">{getDisplayName(contact)}</div>
                <div class="text-xs text-muted-foreground font-mono truncate">{contact.id.substring(0, 10)}...</div>
              </div>
            </div>
            {#if contact.contactRequestState === 3}
              <button onclick={(e) => { e.stopPropagation(); acceptRequest(contact.id); }} class="text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:opacity-90">
                {i18n.t('Accept')}
              </button>
            {:else if contact.mutual}
              <span class="text-xs text-green-600">✓</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </ScrollArea>
</div>
