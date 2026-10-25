<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { statusState } from '$lib/stores/statusStore.svelte';
  import { User, MessageCircle, Wallet as WalletIcon } from 'lucide-svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';

  let { onNavigate }: { onNavigate: (section: string) => void } = $props();

  // Режим: 'welcome' или 'edit'
  let mode = $state<'welcome' | 'edit'>('welcome');

  // Поля для редактирования
  let displayName = $state(statusState.alias || '');
  let userpicOpen = $state(false);
  let userpic = $state<string | null>(originalUserpic);

  let originalDisplayName = $state(statusState.alias || '');
  let originalUserpic = $state<string | null>(null); // null = нет картинки


  // Активна ли кнопка OK
  let isChanged = $derived(
    displayName !== originalDisplayName || userpic !== originalUserpic
  );

  function saveProfile() {
    if (!isChanged) return;
    // TODO: вызов API для сохранения
    // После успеха: обновить originalDisplayName/originalUserpic
    originalDisplayName = displayName;
    originalUserpic = userpic;
    mode = 'welcome';
  }

</script>

<div class="p-8 max-w-2xl mx-auto w-full h-full flex flex-col bg-card">
  {#if mode === 'welcome'}
    <!-- РЕЖИМ WELCOME -->
    <div class="flex-1 flex flex-col items-center justify-center gap-6">
      <div class="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center text-primary">
        <User size={48} />
      </div>

      <div class="text-center space-y-1">
        <h1 class="text-3xl font-bold text-primary">
          {i18n.t('Welcome')}, {statusState.alias || 'User'}!
        </h1>
        <p class="text-muted-foreground">{i18n.t('This is your profile page.')}</p>
      </div>

      <!-- Кнопки Chat и Wallet -->
      <div class="flex gap-4 mt-4">
        <button
          onclick={() => onNavigate('chat')}
          class="flex flex-col items-center gap-2 p-4 border border-border rounded-lg hover:bg-secondary transition"
        >
          <MessageCircle size={28} class="text-primary" />
          <span class="font-medium">{i18n.t('Chat')}</span>
        </button>
        <button
          onclick={() => onNavigate('wallet')}
          class="flex flex-col items-center gap-2 p-4 border border-border rounded-lg hover:bg-secondary transition"
        >
          <WalletIcon size={28} class="text-primary" />
          <span class="font-medium">{i18n.t('Wallet')}</span>
        </button>
      </div>

      <!-- Кнопка Edit Profile -->
      <button
        onclick={() => mode = 'edit'}
        class="mt-4 px-6 py-2 border border-border rounded-md font-medium hover:bg-secondary transition"
      >
        {i18n.t('Edit Profile')}
      </button>
    </div>

  {:else}
    <!-- РЕЖИМ EDIT -->
    <div class="flex flex-col gap-6 max-w-md mx-auto w-full">
      <h2 class="text-2xl font-bold text-primary">{i18n.t('Edit Profile')}</h2>

      <!-- Аватар + кнопка загрузки -->
      <div class="flex items-center gap-4">
        <div class="w-20 h-20 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
          <User size={36} />
        </div>
        <button
          onclick={() => userpicOpen = true}
          class="text-sm text-primary hover:underline"
        >
          {i18n.t('Upload Userpic')}
        </button>
      </div>

      <!-- Display Name -->
      <div>
        <label class="text-sm font-medium text-foreground">Display Name</label>
        <input
          bind:value={displayName}
          class="w-full h-10 border border-input rounded-md px-3 mt-1 bg-background"
        />
      </div>

      <!-- ENS (отложено) -->
      <div>
        <label class="text-sm font-medium text-foreground">ENS Name</label>
        <p class="text-xs text-muted-foreground mt-1">{i18n.t('Available after Wallet integration')}</p>
      </div>

      <!-- Кнопки OK / Cancel -->
      <div class="flex gap-3 mt-4">
        <button
          onclick={() => mode = 'welcome'}
          class="flex-1 py-2 border border-border rounded-md text-sm font-medium hover:bg-secondary transition"
        >
          {i18n.t('Cancel')}
        </button>
        <!-- Кнопка OK: disabled={!isChanged} -->
        <button
          onclick={saveProfile}
          disabled={!isChanged}
          class="flex-1 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
  {i18n.t('OK')}
        </button>
      </div>
    </div>
  {/if}
</div>

<!-- Модальное окно для выбора юзерпика -->
<Dialog.Root bind:open={userpicOpen}>
  <Dialog.Content class="sm:max-w-[425px]">
    <Dialog.Header>
      <Dialog.Title>{i18n.t('Upload Userpic')}</Dialog.Title>
    </Dialog.Header>
    <div class="p-4 border-2 border-dashed border-border rounded-lg text-center">
      <p class="text-sm text-muted-foreground">
        {i18n.t('Drag and drop image here, or click to select')}
      </p>
      <input type="file" accept="image/*" class="mt-2" />
    </div>
    <Dialog.Footer>
      <button onclick={() => userpicOpen = false} class="w-full py-2 bg-primary text-primary-foreground rounded-md">
        {i18n.t('Close')}
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
