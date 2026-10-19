<script lang="ts">
  import { onMount } from 'svelte';
  import { startWallet, getBalances, getSettings } from '$lib/status/api';
  import { formatBalance } from '$lib/utils/format';
  import type { WalletBalance } from '$lib/status/types';

  let { port }: { port: number } = $props();

  let isLoading = $state(false);
  let errorMsg = $state('');
  let walletAddress = $state('');
  let balances = $state<WalletBalance[]>([]);
  let isInitialized = $state(false);

  // Безопасная обёртка для форматирования
  function safeFormat(balance: string, decimals: number): string {
    try {
      return formatBalance(balance, decimals);
    } catch (e) {
      console.warn("Format error:", e);
      return 'Error';
    }
  }

  async function initWallet() {
    if (!port) return;
    isLoading = true;
    errorMsg = '';

    try {
      console.log("Starting wallet...");
      await startWallet(port);

      const settings = await getSettings(port);
      walletAddress = settings.result?.['wallet-root-address'] || '';

      if (!walletAddress) {
        throw new Error("Wallet address not found in settings");
      }
      console.log("Wallet root address:", walletAddress);

      const balanceData = await getBalances(port, [walletAddress]);
      console.log("Balances raw response:", JSON.stringify(balanceData, null, 2));

      if (balanceData.result && typeof balanceData.result === 'object') {
        const tokensForAddress = Object.values(balanceData.result)[0];

        if (Array.isArray(tokensForAddress)) {
          balances = tokensForAddress
            .map((b: any) => ({
              symbol: b.symbol || 'Unknown',
              balance: b.balance || '0',
              decimals: b.decimals || 18,
            }))
            .filter((b: any) => {
              try {
                return BigInt(b.balance) > 0n;
              } catch {
                return false;
              }
            });
        }
      }

      isInitialized = true;
    } catch (e: any) {
      console.error("Wallet init error:", e);
      errorMsg = `Wallet init failed: ${e.message || e}`;
    } finally {
      isLoading = false;
    }
  }

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
            <span class="font-mono">{safeFormat(bal.balance, bal.decimals)}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-gray-500 italic">No balances found or wallet is empty.</p>
    {/if}
  {/if}
</div>
