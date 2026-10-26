<script lang="ts">
  import { onMount } from 'svelte';
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { getContacts, acceptContactRequest } from '$lib/status/api';
  import { statusState, setPendingRequestsCount } from '$lib/stores/statusStore.svelte';
  import { getDisplayName } from '$lib/utils/user';

  let { onSelectContact, onAddContact }: {
    onSelectContact?: (contact: any) => void;
    onAddContact?: () => void;
  } = $props();

  let contacts = $state<any[]>([]);
  let isLoading = $state(true);
  let searchQuery = $state('');

  // Фильтрация по поиску (имя или ключ)
  const filteredContacts = $derived(
    contacts.filter(c =>
      getDisplayName(c).toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );

  async function loadContacts() {
    if (!statusState.backendPort) return;
    isLoading = true;
    try {
      const res = await getContacts(statusState.backendPort);
      contacts = res.result || [];
      const pendingCount = contacts.filter((c: any) => c.contactRequestState === 3).length;
      setPendingRequestsCount(pendingCount);
    } catch (e) {
      console.warn("Failed to load contacts:", e);
    } finally {
      isLoading = false;
    }
  }

  onMount(loadContacts);

  async function handleAccept(keyUid: string, event: Event) {
    event.stopPropagation();
    if (!statusState.backendPort) return;
    try {
      await acceptContactRequest(statusState.backendPort, keyUid);
      await loadContacts(); // Перезагружаем список после принятия
    } catch (e) {
      console.warn("Failed to accept request:", e);
    }
  }
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <!-- Заголовок + кнопка Add Contact -->
  <div class="p-4 border-b border-border flex justify-between items-center">
    <span class="font-bold text-lg text-primary">{i18n.t('Contacts')}</span>
    <button
      onclick={onAddContact}
      class="text-muted-foreground hover:text-primary transition-colors"
      title={i18n.t('Add Contact')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="8.5" cy="7" r="4"/>
        <line x1="20" y1="8" x2="20" y2="14"/>
        <line x1="23" y1="11" x2="17" y2="11"/>
      </svg>
    </button>
  </div>

  <!-- Поле поиска -->
  <div class="p-2 border-b border-border">
    <input
      bind:value={searchQuery}
      placeholder={i18n.t('Search by name or key')}
      class="w-full h-9 border border-input rounded-md px-3 text-sm bg-background"
    />
  </div>

  <ScrollArea class="flex-1">
    {#if isLoading}
      <p class="p-4 text-muted-foreground text-sm">{i18n.t('Loading contacts...')}</p>
    {:else if filteredContacts.length === 0}
      <p class="p-4 text-muted-foreground text-sm italic">{i18n.t('No contacts found')}</p>
    {:else}
      <div class="p-2 space-y-1">
        {#each filteredContacts as contact (contact.id)}
          <!-- Внешний контейнер: клик выбирает контакт -->
          <div
            role="button"
            tabindex="0"
            onclick={() => onSelectContact?.(contact)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectContact?.(contact); }}
            class="w-full text-left p-3 rounded-md hover:bg-secondary transition-colors flex items-center justify-between gap-2 cursor-pointer"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                {getDisplayName(contact).substring(0, 1).toUpperCase()}
              </div>
              <div class="min-w-0">
                <div class="font-medium truncate">{getDisplayName(contact)}</div>
                <div class="text-xs text-muted-foreground font-mono truncate">
                  {contact.id.substring(0, 10)}...
                </div>
              </div>
            </div>

            {#if contact.contactRequestState === 3}
              <!-- Кнопка Accept (вложенная, но теперь во внешнем div, а не в button) -->
              <button
                onclick={(e) => handleAccept(contact.id, e)}
                class="text-xs px-2 py-1 bg-primary text-primary-foreground rounded hover:opacity-90"
              >
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
