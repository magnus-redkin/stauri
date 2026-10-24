<script lang="ts">
  import { statusState } from '$lib/stores/statusStore.svelte';

  function getChainId(): string {
    return statusState.networkName === 'mainnet' ? '1'
      : statusState.networkName === 'sepolia' ? '11155111'
      : statusState.networkName === 'holesky' ? '17000'
      : 'unknown';
  }

  function getNetworkDisplayName(): string {
    return statusState.networkName === 'mainnet'
      ? 'Ethereum Mainnet'
      : statusState.networkName.toUpperCase();
  }
</script>

<div class="mt-3 pt-3 border-t border-border space-y-2">
  <!-- Network Name -->
  <div class="flex items-center justify-between">
    <span class="text-[10px] text-muted-foreground">Network</span>
    <span class="text-[10px] font-semibold text-foreground">
      {getNetworkDisplayName()}
    </span>
  </div>

  <!-- Chain ID -->
  <div class="flex items-center justify-between">
    <span class="text-[10px] text-muted-foreground">Chain ID</span>
    <span class="text-[10px] font-mono text-foreground">
      {getChainId()}
    </span>
  </div>

  <!-- RPC URL -->
  <div class="flex items-start justify-between gap-2">
    <span class="text-[10px] text-muted-foreground shrink-0">RPC</span>
    <span
      class="text-[10px] font-mono text-foreground text-right truncate max-w-[140px]"
      title={statusState.rpcUrl}
    >
      {statusState.rpcUrl}
    </span>
  </div>

  <!-- Waku Fleet -->
  <div class="flex items-center justify-between">
    <span class="text-[10px] text-muted-foreground">Waku Fleet</span>
    <span class="text-[10px] font-medium text-foreground">
      {statusState.wakuFleet}
    </span>
  </div>

  <!-- Testnet Badge -->
  {#if statusState.isTestnet}
    <div class="pt-2">
      <div class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
        <span>⚠️</span>
        <span>Testnet</span>
      </div>
    </div>
  {:else}
    <div class="pt-2">
      <div class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <span>🟢</span>
        <span>Mainnet</span>
      </div>
    </div>
  {/if}
</div>
