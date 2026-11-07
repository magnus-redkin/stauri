<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { walletState } from '$lib/stores/walletStore.svelte';
  import { formatBalance } from '$lib/utils/format';
  import {
    groupAssets,
    chainGroup,
    normalizeSymbol,
    groupLabel,
    CHAIN_NAMES,
    type AssetGroup,
  } from '$lib/utils/assetGroups';

  import ethIcon from 'cryptocurrency-icons/svg/color/eth.svg?url';
  import bnbIcon from 'cryptocurrency-icons/svg/color/bnb.svg?url';
  import usdtIcon from 'cryptocurrency-icons/svg/color/usdt.svg?url';
  import daiIcon from 'cryptocurrency-icons/svg/color/dai.svg?url';
  import sntIcon from 'cryptocurrency-icons/svg/color/snt.svg?url';
  import usdcIcon from 'cryptocurrency-icons/svg/color/usdc.svg?url';

  const SYMBOL_ICONS: Record<string, string> = {
    ETH: ethIcon,
    BNB: bnbIcon,
    USDC: usdcIcon,
    USDT: usdtIcon,
    DAI: daiIcon,
    SNT: sntIcon,
  };

  function iconForSymbol(symbol: string): string | null {
    if (!symbol) return null;
    const upper = symbol.toUpperCase();
    if (SYMBOL_ICONS[upper]) return SYMBOL_ICONS[upper];
    // Поиск по подстроке (USDC.e → USDC)
    for (const k of Object.keys(SYMBOL_ICONS)) {
      if (upper.includes(k)) return SYMBOL_ICONS[k];
    }
    return null;
  }

  // Состав групп (`EVM`, `BSC`, отдельная сеть) живёт в `utils/assetGroups`:
  // там же объяснено, почему тестовые сети нельзя складывать с mainnet.

  const CHAIN_PRIORITY: Record<number, number> = {
    1: 0,
    56: 1,
    10: 2,
    42161: 3,
    8453: 4,
  };

  const TRUSTWALLET_CHAIN: Record<number, string> = {
    1: 'ethereum',
    56: 'smartchain',
    10: 'optimism',
    42161: 'arbitrum',
    8453: 'base',
  };

  const NATIVE_ICONS: Record<number, string> = {
    1: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
    56: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png',
    10: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png',
    42161: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png',
    8453: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png',
  };

  function tokenIconUrl(chainId: number, tokenAddress: string): string | null {
    const chainSlug = TRUSTWALLET_CHAIN[chainId];
    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      return NATIVE_ICONS[chainId] ?? null;
    }
    if (!chainSlug) return null;
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chainSlug}/assets/${tokenAddress}/logo.png`;
  }

  // Кэш иконок, а не реактивное состояние: обновляется вручную через
  // scheduleSaveCache() и не участвует в графе реактивности Svelte.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const iconCache = new Map<string, string>();
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem('stauri:iconCache');
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, string>;
        for (const [k, v] of Object.entries(parsed)) iconCache.set(k, v);
      }
    } catch (e) {
      console.warn('Failed to load icon cache:', e);
    }
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSaveCache() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (typeof localStorage === 'undefined') return;
      try {
        const obj: Record<string, string> = {};
        for (const [k, v] of iconCache) obj[k] = v;
        localStorage.setItem('stauri:iconCache', JSON.stringify(obj));
      } catch (e) {
        console.warn('Failed to save icon cache:', e);
      }
    }, 1000);
  }

  async function loadIcon(url: string): Promise<void> {
    if (iconCache.has(url)) return;
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        iconCache.set(url, 'error');
        scheduleSaveCache();
        return;
      }
      const blob = await resp.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        iconCache.set(url, reader.result as string);
        scheduleSaveCache();
      };
      reader.readAsDataURL(blob);
    } catch {
      iconCache.set(url, 'error');
      scheduleSaveCache();
    }
  }

  /**
   * Группировка вынесена в `$lib/utils/assetGroups`.
   *
   * Здесь она жила inline и складывала все неизвестные сети в одну группу
   * `OTHER`. В mainnet это было незаметно, а в testnet давало ровно 4 строки
   * вместо записей по каждой сети: пять тестовых ETH суммировались в один.
   * Логика, которая решает, что считать одним активом, должна быть покрыта
   * тестами — на код внутри компонента их не напишешь.
   */
  const groupedBalances = $derived(groupAssets(walletState.balances));

  /**
   * Иконка для строки.
   *
   * У одного символа в разных сетях разные адреса контракта, поэтому иконку
   * выбираем один раз: по сети с наибольшим приоритетом (mainnet раньше
   * тестовых).
   */
  const groupIconUrls = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- локальная карта на время вызова
    const icons = new Map<string, string>();
    for (const g of groupedBalances) {
      let bestPriority = Infinity;
      for (const t of walletState.balances) {
        if (normalizeSymbol(t.symbol) !== g.symbol) continue;
        if (t.decimals !== g.decimals) continue;
        if (chainGroup(t.chainId) !== g.group) continue;
        const priority = CHAIN_PRIORITY[t.chainId] ?? 99;
        if (priority >= bestPriority) continue;
        const url = tokenIconUrl(t.chainId, t.tokenAddress);
        if (!url) continue;
        icons.set(g.key, url);
        bestPriority = priority;
      }
    }
    return icons;
  });

  const rows = $derived(
    groupedBalances.map((g) => {
      const iconUrl = groupIconUrls.get(g.key);
      return {
        ...g,
        symbolIcon: iconForSymbol(g.symbol),
        fallbackIconUrl: iconUrl ?? null,
        cachedFallback: iconUrl ? iconCache.get(iconUrl) : undefined,
      };
    })
  );

  $effect(() => {
    for (const g of rows) {
      if (g.symbolIcon) continue;
      if (!g.fallbackIconUrl) continue;
      if (!iconCache.has(g.fallbackIconUrl)) {
        loadIcon(g.fallbackIconUrl);
      }
    }
  });

  /**
   * Имя сети для подписи под строкой.
   *
   * Раньше печатался номер (`Chains: 11155111`) — человек не должен помнить
   * идентификаторы сетей. Неизвестную сеть показываем номером: лучше
   * номер, чем ничего.
   */
  function chainName(chainId: number): string {
    return CHAIN_NAMES[chainId] ?? String(chainId);
  }

  function formatGroupBalance(g: AssetGroup): string {
    if (g.totalBalance === 0n) return '0.00';
    return formatBalance(g.totalBalance.toString(), g.decimals);
  }
</script>

<div class="h-full flex flex-col overflow-hidden">
  {#if walletState.isLoading}
    <p class="p-6 text-muted-foreground">{i18n.t('Loading balances...')}</p>
  {:else if walletState.error}
    <p class="p-6 text-destructive text-sm">{walletState.error}</p>
  {:else if walletState.rpcError}
    <div class="mx-6 my-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm border border-destructive/30">
      {walletState.rpcError}
    </div>
  {/if}

  {#if !walletState.isLoading}
    <ScrollArea class="flex-1 min-h-0">
      {#if rows.length === 0}
        <p class="p-6 text-muted-foreground text-sm italic">{i18n.t('No balances found.')}</p>
      {:else}
        <div class="divide-y divide-border/60">
          {#each rows as g (g.key)}
            <div class="flex items-center justify-between px-6 py-3.5 hover:bg-secondary/40 transition-colors
              {g.hasError ? 'opacity-50' : ''}">

              <div class="flex items-center gap-3 min-w-0">
                <div class="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0 text-sm overflow-hidden">
                  {#if g.symbolIcon}
                    <img src={g.symbolIcon} alt={g.symbol} class="w-full h-full object-cover" />
                  {:else if g.cachedFallback && g.cachedFallback !== 'error'}
                    <img src={g.cachedFallback} alt={g.symbol} class="w-full h-full object-cover" />
                  {:else}
                    {g.symbol.substring(0, 1)}
                  {/if}
                </div>
                <div class="min-w-0">
                  <div class="font-medium text-foreground truncate text-sm">
                    {groupLabel(g)}
                  </div>
                  <div class="text-xs text-muted-foreground">
                    {#if g.hasError}
                      <span class="text-destructive">{i18n.t('RPC error')}</span>
                    {:else}
                      {i18n.t('Chains')}: {g.chains.map((id) => chainName(id)).join(', ')}
                    {/if}
                  </div>
                </div>
              </div>

              <div class="text-right">
                <div class="font-mono text-sm text-foreground">
                  {formatGroupBalance(g)}
                </div>
                <div class="text-xs text-muted-foreground">{g.symbol}</div>
              </div>

            </div>
          {/each}
        </div>
      {/if}
    </ScrollArea>
  {/if}
</div>
