<script lang="ts">
  import { onMount } from 'svelte';
  import { startWallet, getBalances, getSettings } from '$lib/status/api';
  import type { WalletBalance } from '$lib/status/types';
  import { formatBalance } from '$lib/utils/format';

  let { port }: { port: number } = $props();

  let isLoading = $state(false);
  let errorMsg = $state('');
  let walletAddress = $state('');
  let balances = $state<WalletBalance[]>([]);
  let isInitialized = $state(false);

  async function initWallet() {
    if (!port) return;
    isLoading = true;
    errorMsg = '';

    try {
      // 1. Запускаем сервис кошелька
      console.log("Starting wallet...");
      await startWallet(port);

      // 2. Получаем настройки, чтобы узнать адрес кошелька
      const settings = await getSettings(port);
      walletAddress = settings.result?.['wallet-root-address'] || '';

      if (!walletAddress) {
        throw new Error("Wallet address not found in settings");
      }
      console.log("Wallet root address:", walletAddress);

      // 3. Получаем балансы
      const balanceData = await getBalances(port, [walletAddress]);
      // console.log("Balances raw response:", JSON.stringify(balanceData, null, 2)); // Для отладки
      console.log("Balances raw response:", balanceData);

      // Пытаемся распарсить ответ в зависимости от его формы
      // (форма может отличаться в разных версиях status-go)
      let rawBalances: any[] = [];

      if (balanceData.result && typeof balanceData.result === 'object') {
        // result — это объект вида { "0x...": [токен1, токен2, ...] }
        const tokensForAddress = Object.values(balanceData.result)[0] || [];

        if (Array.isArray(tokensForAddress)) {
          balances = tokensForAddress
            .map((b: any) => ({
              symbol: b.symbol || 'Unknown',
              balance: b.balance || '0',
              decimals: b.decimals || 18,
            }))
          // Оставляем только токены с ненулевым балансом для чистоты UI
          // (если хотите видеть все 21 токен, уберите фильтр)
            .filter((b: any) => b.balance !== '0');
        }
      }

      // Преобразуем в наш тип
      balances = rawBalances.map((b: any) => ({
        symbol: b.symbol || b.token?.symbol || 'Unknown',
        balance: b.balance || b.amount || '0',
        decimals: b.decimals || b.token?.decimals || 18,
      })).filter(b => b.balance !== '0');

      isInitialized = true;
    } catch (e: any) {
      console.error("Wallet init error:", e);
      errorMsg = `Wallet init failed: ${e.message || e}`;
    } finally {
      isLoading = false;
    }
  }

  // Запускаем при монтировании
  onMount(() => {
    initWallet();
  });
</script>

<div class="w-full bg-white dark:bg-gray-800 rounded-lg shadow p-6">
  <div class="flex justify-between items-center mb-4 border-b pb-2 dark:border-gray-700">
    <h2 class="text-xl font-bold">Wallet</h2>
    {#if isLoading}
      <span class="text-sm text-gray-500">Loading...</span>
    {/if}
  </div>

  {#if errorMsg}
    <div class="p-3 mb-4 bg-red-100 text-red-700 rounded-lg text-sm">{errorMsg}</div>
  {/if}

  {#if walletAddress}
    <div class="mb-4">
      <span class="text-sm text-gray-500">Wallet Address:</span>
      <div class="font-mono text-sm bg-gray-100 dark:bg-gray-700 p-2 rounded break-all">{walletAddress}</div>
    </div>
  {/if}

  {#if isInitialized}
    {#if balances.length > 0}
      <h3 class="font-semibold mb-2">Balances:</h3>
      <ul class="space-y-2">
        {#each balances as bal, i (bal.symbol + i)}
          <li class="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border dark:border-gray-600 flex justify-between items-center">
            <span class="font-semibold">{bal.symbol}</span>
            <span class="font-mono">{formatBalance(bal.balance, bal.decimals)}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-gray-500 italic">No balances found or wallet is empty.</p>
    {/if}
  {/if}
</div>
