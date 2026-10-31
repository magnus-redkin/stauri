<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { walletState } from '$lib/stores/walletStore.svelte';
  import { formatBalance } from '$lib/utils/format';

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

  // Все сети, где токен считается «одной группой»
  const EVM_CHAINS = new Set([1, 10, 42161, 8453]);
  const BSC_CHAINS = new Set([56, 97]);

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

  function chainGroup(chainId: number): string {
    if (EVM_CHAINS.has(chainId)) return 'EVM';
    if (BSC_CHAINS.has(chainId)) return 'BSC';
    return 'OTHER'; // вместо String(chainId) — всё неизвестное в одну группу
  }

  function tokenIconUrl(chainId: number, tokenAddress: string): string | null {
    const chainSlug = TRUSTWALLET_CHAIN[chainId];
    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      return NATIVE_ICONS[chainId] ?? null;
    }
    if (!chainSlug) return null;
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chainSlug}/assets/${tokenAddress}/logo.png`;
  }

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

  type Group = {
    key: string;
    symbol: string;
    decimals: number;
    totalBalance: bigint;
    chains: number[];
    hasError: boolean;
    fallbackIconUrl: string | null;
  };

  const groupedBalances = $derived.by(() => {
    const map = new Map<string, Group>();
    const chainToAddress = new Map<string, Map<number, string>>();

    for (const token of walletState.balances) {
      // 🔥 Нормализация: обрезаем пробелы, приводим к верхнему регистру
      const normalizedSymbol = String(token.symbol || '')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')  // zero-width
            .trim()
            .toUpperCase();
      const key = `${normalizedSymbol}:${chainGroup(token.chainId)}`;
      const raw = BigInt(token.balance || '0');
      const existing = map.get(key);
      if (existing) {
        existing.totalBalance += raw;
        if (!existing.chains.includes(token.chainId)) {
          existing.chains.push(token.chainId);
        }
        existing.hasError = existing.hasError || token.hasError;
      } else {
        map.set(key, {
          key,
          symbol: normalizedSymbol,
          decimals: token.decimals,
          totalBalance: raw,
          chains: [token.chainId],
          hasError: token.hasError,
          fallbackIconUrl: null,
        });
        chainToAddress.set(key, new Map());
      }
      chainToAddress.get(key)?.set(token.chainId, token.tokenAddress);
    }

    for (const [key, group] of map) {
      const byChain = chainToAddress.get(key);
      if (!byChain) continue;
      const sorted = [...group.chains].sort(
        (a, b) => (CHAIN_PRIORITY[a] ?? 99) - (CHAIN_PRIORITY[b] ?? 99)
      );
      for (const chainId of sorted) {
        const addr = byChain.get(chainId);
        if (!addr) continue;
        const url = tokenIconUrl(chainId, addr);
        if (url) {
          group.fallbackIconUrl = url;
          break;
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      const aZero = a.totalBalance === 0n ? 1 : 0;
      const bZero = b.totalBalance === 0n ? 1 : 0;
      if (aZero !== bZero) return aZero - bZero;
      return a.symbol.localeCompare(b.symbol);
    });
  });

  const rows = $derived(groupedBalances.map(g => ({
    ...g,
    symbolIcon: iconForSymbol(g.symbol),
    cachedFallback: g.fallbackIconUrl ? iconCache.get(g.fallbackIconUrl) : undefined,
  })));

  $effect(() => {
    for (const g of groupedBalances) {
      if (iconForSymbol(g.symbol)) continue;
      if (!g.fallbackIconUrl) continue;
      if (!iconCache.has(g.fallbackIconUrl)) {
        loadIcon(g.fallbackIconUrl);
      }
    }
    iconCache.size;
  });

  function formatGroupBalance(g: Group): string {
    if (g.totalBalance === 0n) return '0.00';
    return formatBalance(g.totalBalance.toString(), g.decimals);
  }

  function displayName(g: Group): string {
    const group = g.key.split(':')[1];
    if (group === 'EVM' || group === 'BSC') return `${g.symbol} (${group})`;
    return g.symbol;
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
    <ScrollArea class="flex-1">
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
                    {displayName(g)}
                  </div>
                  <div class="text-xs text-muted-foreground">
                    {#if g.hasError}
                      <span class="text-destructive">{i18n.t('RPC error')}</span>
                    {:else}
                      {i18n.t('Chains')}: {g.chains.join(', ')}
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
