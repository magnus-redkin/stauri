<script lang="ts">
  import { i18n } from '$lib/i18n';

  let {
    selectedNetwork = $bindable('mainnet'),
    onSelect
  }: {
    selectedNetwork: string;
    onSelect?: (network: string) => void;
  } = $props();

  let isTestnetExpanded = $state(false);

  const mainnet = 'mainnet';
  const testnets = ['sepolia', 'holesky'];

  function selectNetwork(net: string) {
    selectedNetwork = net;
    if (onSelect) onSelect(net);
    isTestnetExpanded = false; // Схлопываем после выбора
  }

  function toggleTestnet() {
    // Просто переключаем видимость списка, НЕ выбирая сеть
    isTestnetExpanded = !isTestnetExpanded;
  }

  // Проверка, выбран ли тестнет (для подсветки кнопки)
  const isTestnetSelected = $derived(selectedNetwork !== mainnet);
</script>

<div class="w-full max-w-md space-y-2">
  <!-- Кнопка Mainnet -->
  <button
    onclick={() => selectNetwork(mainnet)}
    class="w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors {selectedNetwork === mainnet ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-border hover:bg-secondary'}"
  >
    <div class="w-2 h-2 rounded-full {selectedNetwork === mainnet ? 'bg-green-500' : 'bg-gray-400'}"></div>
    <span class="font-medium text-foreground">Mainnet</span>
  </button>

  <!-- Кнопка Testnet (с раскрытием) -->
  <div class="relative">
    <button
      onclick={toggleTestnet}
      class="w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors {isTestnetSelected ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-border hover:bg-secondary'}"
    >
      <div class="flex items-center gap-3">
        <div class="w-2 h-2 rounded-full {isTestnetSelected ? 'bg-orange-500' : 'bg-gray-400'}"></div>
        <span class="font-medium text-foreground">Testnet</span>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground transition-transform {isTestnetExpanded ? 'rotate-180' : ''}">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>

    <!-- Выпадающий список тестнетов (показываем если раскрыт) -->
    {#if isTestnetExpanded}
      <div class="mt-2 ml-4 space-y-1">
        {#each testnets as net}
          <button
            onclick={() => selectNetwork(net)}
            class="w-full text-left px-4 py-2 rounded-md text-sm transition-colors {selectedNetwork === net ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 font-medium' : 'hover:bg-secondary text-muted-foreground'}"
          >
            {net.charAt(0).toUpperCase() + net.slice(1)}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
