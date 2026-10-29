<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { walletState, loadWallet } from '$lib/stores/walletStore.svelte';
  import { statusState } from '$lib/stores/statusStore.svelte';
  import { onMount } from 'svelte';

  onMount(() => loadWallet());
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border flex justify-between items-center">
    <span class="font-bold text-lg text-primary">{i18n.t('Wallet')}</span>
  </div>

  <ScrollArea class="flex-1">
    {#if walletState.isLoading}
      <p class="p-4 text-muted-foreground text-sm">{i18n.t('Loading wallet...')}</p>
    {:else if walletState.error}
      <p class="p-4 text-destructive text-sm">{walletState.error}</p>
    {:else}
      <div class="p-3 mb-2 rounded-lg bg-secondary/50">
        <div class="text-sm text-muted-foreground">{i18n.t('All accounts')}</div>
        <div class="text-xl font-bold text-foreground">
          {walletState.balances.length} {i18n.t('tokens')}
        </div>
        {#if walletState.address}
          <div class="text-xs font-mono text-muted-foreground break-all mt-1">
            {walletState.address.substring(0, 10)}...
          </div>
        {/if}
      </div>
    {/if}
  </ScrollArea>
</div>
