<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";

  // Пропсы: колбэк для навигации
  let { onNavigate }: { onNavigate?: (section: string) => void } = $props();

  // Моковые данные аккаунтов (цвет теперь часть данных аккаунта)
  const accounts = [
    { id: 1, name: "Account 1", balance: "0.00 USD", color: "bg-blue-500" },
  ];

  // Состояние для модального окна
  let isAddAccountOpen = $state(false);
  let newAccountName = $state("");
  let selectedColor = $state("bg-blue-500");

  const colors = [
    "bg-blue-500", "bg-indigo-500", "bg-orange-500", "bg-teal-600",
    "bg-cyan-600", "bg-sky-500", "bg-yellow-500", "bg-pink-400",
    "bg-red-400", "bg-orange-300", "bg-pink-500", "bg-gray-900"
  ];

  function createAccount() {
    // Заглушка для песочницы
    isAddAccountOpen = false;
    newAccountName = "";
    // Сбрасываем цвет для следующего открытия
    selectedColor = "bg-blue-500";
  }
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border flex justify-between items-center">
    <span class="font-bold text-lg text-primary">{i18n.t('Wallet')}</span>
    <!-- Кнопка добавления аккаунта открывает диалог -->
    <button onclick={() => isAddAccountOpen = true} class="text-muted-foreground hover:text-primary transition-colors">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
    </button>
  </div>

  <ScrollArea class="flex-1">
    <div class="p-2 space-y-1">
      <!-- Общий баланс -->
      <div class="p-3 mb-2 rounded-lg bg-secondary/50">
        <div class="text-sm text-muted-foreground">{i18n.t('All accounts')}</div>
        <div class="text-xl font-bold text-foreground">0.00 USD</div>
      </div>

      <!-- Список аккаунтов -->
      {#each accounts as acc (acc.id)}
        <button class="w-full text-left p-3 rounded-md hover:bg-secondary flex items-center gap-3 transition-colors border border-transparent hover:border-border">
          <!-- Цвет берется из acc.color -->
          <div class="w-8 h-8 rounded-full {acc.color} flex items-center justify-center text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          </div>
          <div>
            <div class="font-medium text-foreground">{acc.name}</div>
            <div class="text-xs text-muted-foreground">{acc.balance}</div>
          </div>
        </button>
      {/each}

      <div class="w-full h-px bg-border my-2"></div>

      <!-- Навигация к Saved addresses -->
      <button
        onclick={() => onNavigate?.('saved-addresses')}
        class="w-full text-left p-3 rounded-md hover:bg-secondary flex items-center gap-3 transition-colors"
      >
        <div class="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
           <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
        </div>
        <span class="font-medium text-foreground">{i18n.t('Saved addresses')}</span>
      </button>

      <!-- Навигация к Onchain friends -->
      <button
        onclick={() => onNavigate?.('onchain-friends')}
        class="w-full text-left p-3 rounded-md hover:bg-secondary flex items-center gap-3 transition-colors"
      >
        <div class="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">
           <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <span class="font-medium text-foreground">{i18n.t('Onchain friends')}</span>
      </button>
    </div>
  </ScrollArea>
</div>

<!-- Модальное окно создания аккаунта -->
<Dialog.Root bind:open={isAddAccountOpen}>
  <Dialog.Content class="sm:max-w-[425px]">
    <Dialog.Header>
      <Dialog.Title>{i18n.t('Add a new account')}</Dialog.Title>
    </Dialog.Header>

    <div class="grid gap-4 py-4">
      <div class="grid gap-2">
        <label class="text-sm font-medium">{i18n.t('Name')}</label>
        <input
          type="text"
          bind:value={newAccountName}
          placeholder={i18n.t('Account name')}
          maxlength="20"
          class="w-full h-10 border border-border rounded-md px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div class="grid gap-2">
        <label class="text-sm font-medium">{i18n.t('Colour')}</label>
        <div class="grid grid-cols-4 gap-3 mt-1">
          {#each colors as color (color)}
            <button
              onclick={() => selectedColor = color}
              class="w-10 h-10 rounded-full {color} {selectedColor === color ? 'ring-2 ring-offset-2 ring-primary' : ''} transition-all"
            ></button>
          {/each}
        </div>
      </div>
    </div>

    <Dialog.Footer>
      <button
        onclick={createAccount}
        disabled={!newAccountName}
        class="w-full h-10 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {i18n.t('Add account')}
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
