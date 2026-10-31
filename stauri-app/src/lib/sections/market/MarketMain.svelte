<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { fetchMarketData, type MarketCoin } from '$lib/status/api';

  let coins = $state<MarketCoin[]>([]);
  let isLoading = $state(true);
  let error = $state('');

  async function load() {
    isLoading = true;
    error = '';
    try {
      coins = await fetchMarketData();
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      isLoading = false;
    }
  }

  $effect(() => { load(); });

  function formatUsd(n: number): string {
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
</script>

<div class="h-full flex flex-col p-6 bg-card overflow-hidden">
  <div class="flex justify-between items-center mb-6">
    <h2 class="text-3xl font-bold text-primary">{i18n.t('Market')}</h2>
  </div>

  {#if isLoading}
    <p class="text-muted-foreground">{i18n.t('Loading market data...')}</p>
  {:else if error}
    <p class="text-destructive text-sm">{error}</p>
  {:else}
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
            {#each coins as coin, i (coin.id)}
              <tr class="border-b border-border hover:bg-secondary/30 transition-colors">
                <td class="px-4 py-4 text-center text-muted-foreground">{i + 1}</td>
                <td class="px-4 py-4">
                  <div class="flex items-center gap-3">
                    <img src={coin.image} alt={coin.symbol} class="w-8 h-8 rounded-full" />
                    <div>
                      <div class="font-medium text-foreground">{coin.name}</div>
                      <div class="text-xs text-muted-foreground">{coin.symbol.toUpperCase()}</div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-4 text-right font-mono">{formatUsd(coin.current_price)}</td>
                <td class="px-4 py-4 text-right font-mono {coin.price_change_percentage_24h && coin.price_change_percentage_24h >= 0 ? 'text-green-600' : 'text-red-500'}">
                  {#if coin.price_change_percentage_24h !== null}
                    {coin.price_change_percentage_24h >= 0 ? '▲' : '▼'}
                    {Math.abs(coin.price_change_percentage_24h).toFixed(2)}%
                  {:else}
                    —
                  {/if}
                </td>
                <td class="px-4 py-4 text-right font-mono text-muted-foreground">{formatUsd(coin.total_volume)}</td>
                <td class="px-4 py-4 text-right font-mono">{formatUsd(coin.market_cap)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  {/if}
</div>
