<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";

  // Моковые данные (первые 10 монет)
  const tokens = [
    { rank: 1, name: "Bitcoin", symbol: "BTC", price: "$81,413.00", change: "-3.83%", isUp: false, volume: "$34,683,018,345", mcap: "$1,636.53B" },
    { rank: 2, name: "Ethereum", symbol: "ETH", price: "$2,387.75", change: "-4.76%", isUp: false, volume: "$11,706,956,721", mcap: "$291.71B" },
    { rank: 3, name: "Tether", symbol: "USDT", price: "$1.00", change: "-0.02%", isUp: false, volume: "$55,658,864,708", mcap: "$182.68B" },
    { rank: 4, name: "BNB", symbol: "BNB", price: "$729.40", change: "-2.69%", isUp: false, volume: "$730,930,343", mcap: "$95,925,389,027" },
    { rank: 5, name: "XRP", symbol: "XRP", price: "$1.32", change: "-4.13%", isUp: false, volume: "$1,675,868,530", mcap: "$83,473,044,584" },
    { rank: 6, name: "USDC", symbol: "USDC", price: "$1.00", change: "0.00%", isUp: true, volume: "$13,575,661,902", mcap: "$72,225,616,459" },
    { rank: 7, name: "Solana", symbol: "SOL", price: "$104.17", change: "-3.82%", isUp: false, volume: "$2,614,014,815", mcap: "$61,390,904,866" },
  ];

  // Состояние пагинации
  let currentPage = $state(1);
  const totalPages = 50; // Мок

  // Функция для смены страницы
  function setPage(page: number) {
    if (page >= 1 && page <= totalPages) {
      currentPage = page;
    }
  }
</script>

<div class="h-full flex flex-col p-6 bg-card overflow-hidden">
  <!-- Заголовок и кнопка Swap -->
  <div class="flex justify-between items-center mb-6">
    <h2 class="text-3xl font-bold text-primary">{i18n.t('Market')}</h2>
    <button class="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors flex items-center gap-2">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>
      {i18n.t('Swap')}
    </button>
  </div>

  <!-- Таблица -->
  <div class="flex-1 overflow-hidden border border-border rounded-lg">
    <ScrollArea class="h-full">
      <table class="w-full text-sm text-left">
        <thead class="text-xs text-muted-foreground uppercase bg-secondary/50 sticky top-0 z-10">
          <tr>
            <th class="px-4 py-3 w-12 text-center">#</th>
            <th class="px-4 py-3">{i18n.t('Token')}</th>
            <th class="px-4 py-3 text-right">{i18n.t('Price')}</th>
            <th class="px-4 py-3 text-right">{i18n.t('24hr')}</th>
            <th class="px-4 py-3 text-right">{i18n.t('24hr Volume')}</th>
            <th class="px-4 py-3 text-right">{i18n.t('Market Cap')}</th>
          </tr>
        </thead>
        <tbody>
          {#each tokens as token}
            <tr class="border-b border-border hover:bg-secondary/30 transition-colors">
              <td class="px-4 py-4 text-center text-muted-foreground">{token.rank}</td>
              <td class="px-4 py-4">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-secondary flex items-center justify-center font-bold text-xs">
                    {token.symbol.substring(0, 1)}
                  </div>
                  <div>
                    <div class="font-medium text-foreground">{token.name}</div>
                    <div class="text-xs text-muted-foreground">{token.symbol}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-4 text-right font-mono">{token.price}</td>
              <td class="px-4 py-4 text-right font-mono {token.isUp ? 'text-green-600' : 'text-red-500'}">
                {token.isUp ? '▲' : '▼'} {token.change}
              </td>
              <td class="px-4 py-4 text-right font-mono text-muted-foreground">{token.volume}</td>
              <td class="px-4 py-4 text-right font-mono">{token.mcap}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </ScrollArea>
  </div>

  <!-- Пагинация -->
  <div class="flex items-center justify-between mt-4 text-sm text-muted-foreground">
    <div>
      {i18n.t('Showing')} 1 {i18n.t('to')} 100 {i18n.t('of')} 5000 {i18n.t('results')}
    </div>
    <div class="flex items-center gap-1">
      <button
        onclick={() => setPage(currentPage - 1)}
        disabled={currentPage === 1}
        class="p-1 rounded hover:bg-secondary disabled:opacity-50 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </button>

      <button class="w-8 h-8 rounded-md bg-secondary/50 text-foreground font-medium">1</button>
      <button class="w-8 h-8 rounded-md hover:bg-secondary text-muted-foreground">2</button>
      <button class="w-8 h-8 rounded-md hover:bg-secondary text-muted-foreground">3</button>
      <span class="px-1">...</span>
      <button class="w-8 h-8 rounded-md hover:bg-secondary text-muted-foreground">50</button>

      <button
        onclick={() => setPage(currentPage + 1)}
        disabled={currentPage === totalPages}
        class="p-1 rounded hover:bg-secondary disabled:opacity-50 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </button>
    </div>
  </div>
</div>
