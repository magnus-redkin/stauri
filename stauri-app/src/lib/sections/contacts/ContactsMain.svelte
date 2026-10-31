<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { contactsState, selectContact } from '$lib/stores/contactsStore.svelte';
  import { sendContactRequest } from '$lib/status/api';
  import { statusState } from '$lib/stores/statusStore.svelte';
  import { getDisplayName } from '$lib/utils/user';

  // Для перехода в чат
  let { onOpenChat }: { onOpenChat?: (chatId: string) => void } = $props();

  let publicKey = $state('');
  let message = $state('');
  let isSending = $state(false);
  let error = $state('');

  async function handleSend() {
    if (!publicKey.trim() || !statusState.backendPort) return;
    isSending = true;
    error = '';
    try {
      await sendContactRequest(statusState.backendPort, publicKey.trim(), message.trim());
      publicKey = '';
      message = '';
      alert(i18n.t('Contact request sent!'));
    } catch (e: any) {
      error = e.message;
    } finally {
      isSending = false;
    }
  }

  async function handleRemove() {
    if (!confirm(i18n.t('Remove this contact?'))) return;
    alert(i18n.t('Remove not yet implemented.'));
  }

  async function handleBlock() {
    if (!confirm(i18n.t('Block this user?'))) return;
    alert(i18n.t('Block not yet implemented.'));
  }
</script>

<div class="p-6 max-w-md mx-auto w-full h-full overflow-y-auto">
  {#if contactsState.selected}
    <!-- ДЕТАЛИ КОНТАКТА -->
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-2xl font-bold text-primary">{getDisplayName(contactsState.selected)}</h2>
      <button onclick={() => selectContact(null)} class="text-muted-foreground hover:text-foreground">✕</button>
    </div>

    <div class="space-y-4">
      <div>
        <span class="text-xs font-bold text-muted-foreground uppercase">Public Key</span>
        <div class="font-mono text-xs bg-secondary p-2 rounded break-all">{contactsState.selected.id}</div>
      </div>

      {#if contactsState.selected.mutual}
        <p class="text-sm text-green-600">✓ {i18n.t('Contact is mutual')}</p>
      {:else if contactsState.selected.contactRequestState === 3}
        <p class="text-sm text-orange-600">⚠️ {i18n.t('Contact request pending')}</p>
      {/if}

      <!-- Кнопка "Чат" -->
      {#if contactsState.selected.mutual || contactsState.selected.contactRequestState === 3}
        <button
          onclick={() => onOpenChat?.(contactsState.selected.id)}
          class="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
        >
          {i18n.t('Chat')}
        </button>
      {/if}

      <div class="pt-4 border-t border-border space-y-2">
        <button onclick={handleRemove} class="w-full py-2 border border-red-300 text-red-600 rounded-md text-sm hover:bg-red-50">
          {i18n.t('Remove Contact')}
        </button>
        <button onclick={handleBlock} class="w-full py-2 border border-red-300 text-red-600 rounded-md text-sm hover:bg-red-50">
          {i18n.t('Block User')}
        </button>
      </div>
    </div>
  {:else}
    <!-- ФОРМА ADD CONTACT -->
    <h2 class="text-2xl font-bold text-primary mb-6">{i18n.t('Add Contact')}</h2>
    <p class="text-sm text-muted-foreground mb-4">{i18n.t('Enter a public key to send a contact request.')}</p>

    {#if error}<p class="text-destructive text-sm mb-4">{error}</p>{/if}

    <div class="space-y-4">
      <div>
        <label class="text-sm font-medium">Public Key</label>
        <input bind:value={publicKey} placeholder="0x..." class="w-full h-10 border border-input rounded-md px-3 mt-1 font-mono text-sm" />
      </div>
      <div>
        <label class="text-sm font-medium">{i18n.t('Message (optional)')}</label>
        <input bind:value={message} placeholder={i18n.t('Hello!')} class="w-full h-10 border border-input rounded-md px-3 mt-1" />
      </div>
      <button onclick={handleSend} disabled={isSending || !publicKey.trim()} class="w-full py-2 bg-primary text-primary-foreground rounded-md font-medium disabled:opacity-50">
        {isSending ? i18n.t('Sending...') : i18n.t('Send Request')}
      </button>
    </div>
  {/if}
</div>
