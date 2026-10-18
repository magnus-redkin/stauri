<script lang="ts">
  import { startWallet, getBalances, getSettings } from '$lib/status/api';

  let { port }: { port: number } = $props();

  let isLoading = $state(false);
  let errorMsg = $state('');
  let walletAddress = $state('');
  let balances = $state<any[]>([]);
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
      console.log("Wallet root address:", walletAddress);

      // 3. Пытаемся получить балансы (если адрес есть)
      if (walletAddress) {
        try {
          const balanceData = await getBalances(port, [walletAddress]);
          console.log("Balances raw response:", balanceData);

          // В зависимости от версии, балансы могут быть в result или в result.balances
          if (balanceData.result) {
            // Если result — это объект с ключами (адресами), преобразуем в массив
            if (typeof balanceData.result === 'object' && !Array.isArray(balanceData.result)) {
              balances = Object.values(balanceData.result);
            } else if (Array.isArray(balanceData.result)) {
              balances = balanceData.result;
            }
          }
        } catch (e: any) {
          console.warn("Failed to fetch balances:", e);
          errorMsg = `Balances fetch failed: ${e.message || e} (Address is shown below)`;
        }
      }

      isInitialized = true;
    } catch (e: any) {
      errorMsg = `Wallet init failed: ${e.message || e}`;
    } finally {
      isLoading = false;
    }
  }
</script>

<div class="w-full bg-white dark:bg-gray-800 rounded-lg shadow p-6">
  <div class="flex justify-between items-center mb-4 border-b pb-2 dark:border-gray-700">
    <h2 class="text-xl font-bold">Wallet</h2>
    {#if !isInitialized}
      <button
        onclick={initWallet}
        disabled={isLoading}
        class="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:bg-gray-400"
      >
        {isLoading ? 'Starting...' : 'Start Wallet'}
      </button>
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
        {#each balances as bal}
          <li class="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border dark:border-gray-600">
            <div class="font-semibold">{bal.symbol || bal.token?.symbol || 'Unknown Token'}</div>
            <div class="text-sm">{bal.balance || bal.amount || '0'}</div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-gray-500 italic">No balances found or wallet is empty.</p>
    {/if}
  {/if}
</div>
