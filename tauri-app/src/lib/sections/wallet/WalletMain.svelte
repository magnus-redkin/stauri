<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

  // Моковые данные токенов
  const tokens = [
    { symbol: "USDS", name: "USDS", balance: "0.00 USDS", usd: "0.00 USD", change: "+0.00%", isUp: true },
    { symbol: "USDC", name: "USDC (EVM)", balance: "0 USDC", usd: "0.00 USD", change: "+0.02%", isUp: true },
    { symbol: "USDC", name: "USDC (BSC)", balance: "0 USDC", usd: "0.00 USD", change: "+0.02%", isUp: true },
    { symbol: "SNT", name: "Status", balance: "0 SNT", usd: "0.00 USD", change: "-1.03%", isUp: false },
    { symbol: "ETH", name: "Ethereum", balance: "0 ETH", usd: "0.00 USD", change: "-1.50%", isUp: false },
  ];

  let activeTab = $state<'assets' | 'collectibles' | 'history'>('assets');
</script>

<div class="h-full flex flex-col p-6 bg-card overflow-hidden">
  <!-- Заголовок и баланс -->
  <div class="flex justify-between items-start mb-6">
    <div>
      <h2 class="text-2xl font-bold text-primary">{i18n.t('All accounts')}</h2>
      <div class="text-3xl font-mono mt-1">0.00 USD</div>
    </div>
    <!-- Кнопки справа (Refresh, Send, Receive) -->
    <div class="flex gap-2">
      <button class="p-2 rounded-md border border-border hover:bg-secondary text-muted-foreground">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l5.16-5.16"/></svg>
      </button>
      <button class="p-2 rounded-md border border-border hover:bg-secondary text-muted-foreground">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
      </button>
      <button class="p-2 rounded-md border border-border hover:bg-secondary text-muted-foreground">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>
      </button>
    </div>
  </div>

  <!-- Вкладки -->
  <div class="flex border-b border-border mb-4">
    <button class="px-4 py-2 font-medium text-sm transition-colors border-b-2 {activeTab === 'assets' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}" onclick={() => activeTab = 'assets'}>
      {i18n.t('Assets')}
    </button>
    <button class="px-4 py-2 font-medium text-sm transition-colors border-b-2 {activeTab === 'collectibles' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}" onclick={() => activeTab = 'collectibles'}>
      {i18n.t('Collectibles')}
    </button>
    <button class="px-4 py-2 font-medium text-sm transition-colors border-b-2 {activeTab === 'history' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}" onclick={() => activeTab = 'history'}>
      {i18n.t('History')}
    </button>
  </div>

  {#if activeTab === 'assets'}
    <!-- Карточки действий (Ways to buy, Receive) -->
    <div class="grid grid-cols-2 gap-4 mb-6">
      <button class="p-4 rounded-xl border border-border hover:bg-secondary text-left flex items-center gap-3 transition-colors">
        <div class="text-2xl">💳</div>
        <div>
          <div class="font-bold text-foreground">{i18n.t('Ways to buy')}</div>
          <div class="text-xs text-muted-foreground">{i18n.t('Via card or bank')}</div>
        </div>
      </button>
      <button class="p-4 rounded-xl border border-border hover:bg-secondary text-left flex items-center gap-3 transition-colors">
        <div class="text-2xl">📥</div>
        <div>
          <div class="font-bold text-foreground">{i18n.t('Receive')}</div>
          <div class="text-xs text-muted-foreground">{i18n.t('Deposit to your Wallet')}</div>
        </div>
      </button>
    </div>

    <!-- Список токенов -->
    <ScrollArea class="flex-1 -mx-2 px-2">
      <div class="space-y-1">
        {#each tokens as token (token.symbol)}
          <button class="w-full text-left p-3 rounded-lg hover:bg-secondary flex items-center justify-between transition-colors">
            <div class="flex items-center gap-3">
              <!-- Иконка токена (заглушка) -->
              <div class="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-foreground">
                {token.symbol.substring(0, 1)}
              </div>
              <div>
                <div class="font-medium text-foreground">{token.name}</div>
                <div class="text-xs text-muted-foreground">{token.balance}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="font-medium text-foreground">{token.usd}</div>
              <div class="text-xs {token.isUp ? 'text-green-600' : 'text-red-500'}">{token.change}</div>
            </div>
          </button>
        {/each}
      </div>
    </ScrollArea>
  {:else}
    <div class="flex-1 flex items-center justify-center text-muted-foreground">
      {i18n.t('Coming Soon')}
    </div>
  {/if}
</div>
