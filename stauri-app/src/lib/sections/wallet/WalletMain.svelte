<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { walletState, loadWallet } from '$lib/stores/walletStore.svelte';
  import WalletAssetsTab from './tabs/WalletAssetsTab.svelte';
  import WalletSendTab from './tabs/WalletSendTab.svelte';
  import WalletReceiveTab from './tabs/WalletReceiveTab.svelte';
  import WalletBuyTab from './tabs/WalletBuyTab.svelte';
  import WalletSwapTab from './tabs/WalletSwapTab.svelte';

  type WalletTab = 'assets' | 'send' | 'receive' | 'buy' | 'swap';

  let activeTab = $state<WalletTab>('assets');

  const tabs: { id: WalletTab; label: string; disabled?: boolean }[] = [
    { id: 'assets', label: i18n.t('Assets') },
    { id: 'send', label: i18n.t('Send') },
    { id: 'receive', label: i18n.t('Receive') },
    { id: 'buy', label: i18n.t('Buy'), disabled: true },
    { id: 'swap', label: i18n.t('Swap'), disabled: true },
  ];

  function selectTab(tab: (typeof tabs)[number]) {
    if (tab.disabled) return;
    activeTab = tab.id;
  }

  async function refresh() {
    await loadWallet(true);
  }
</script>

<div class="h-full flex flex-col bg-card overflow-hidden">
  <!-- Шапка: заголовок + адрес + кнопка обновления -->
  <div class="p-6 pb-0 flex justify-between items-start">
    <div>
      <h2 class="text-2xl font-bold text-primary">{i18n.t('All accounts')}</h2>
      {#if walletState.address}
        <div class="text-xs font-mono text-muted-foreground mt-1 break-all">
          {walletState.address}
        </div>
      {/if}
    </div>
    <button
      onclick={refresh}
      class="p-2 rounded-md border border-border hover:bg-secondary transition-colors"
      title={i18n.t('Refresh')}
    >
      🔄
    </button>
  </div>

  <!-- Кнопки-вкладки -->
  <div class="px-6 mt-4 border-b border-border flex gap-1 overflow-x-auto">
    {#each tabs as tab (tab.id)}
      <button
        onclick={() => selectTab(tab)}
        disabled={tab.disabled}
        class="px-4 py-2 text-sm font-medium rounded-t-md transition-colors whitespace-nowrap
          {activeTab === tab.id
            ? 'text-primary border-b-2 border-primary -mb-px bg-secondary/30'
            : tab.disabled
              ? 'text-muted-foreground/50 cursor-not-allowed'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}"
        title={tab.disabled ? i18n.t('Coming soon') : ''}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Контент вкладки -->
  <div class="flex-1 overflow-hidden">
    {#if activeTab === 'assets'}
      <WalletAssetsTab />
    {:else if activeTab === 'send'}
      <WalletSendTab />
    {:else if activeTab === 'receive'}
      <WalletReceiveTab />
    {:else if activeTab === 'buy'}
      <WalletBuyTab />
    {:else if activeTab === 'swap'}
      <WalletSwapTab />
    {/if}
  </div>
</div>
