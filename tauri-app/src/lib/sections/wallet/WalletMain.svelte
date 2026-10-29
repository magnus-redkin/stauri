<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { walletState, loadWallet } from '$lib/stores/walletStore.svelte';
  import { formatBalance } from '$lib/utils/format';

  async function refresh() {
    await loadWallet(true);
  }
</script>

<div class="h-full flex flex-col p-6 bg-card overflow-hidden">
  <div class="flex justify-between items-start mb-6">
    <div>
      <h2 class="text-2xl font-bold text-primary">{i18n.t('All accounts')}</h2>
      {#if walletState.address}
        <div class="text-xs font-mono text-muted-foreground mt-1 break-all">
          {walletState.address}
        </div>
      {/if}
    </div>
    <button onclick={refresh} class="p-2 rounded-md border border-border hover:bg-secondary">
      🔄
    </button>
  </div>

  {#if walletState.isLoading && walletState.balances.length === 0}
    <p class="text-muted-foreground">{i18n.t('Loading balances...')}</p>
  {:else if walletState.error}
    <p class="text-destructive text-sm">{walletState.error}</p>
  {:else}
    {#if walletState.rpcError}
      <div class="mb-4 p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm">
        ⚠️ {walletState.rpcError}
      </div>
    {/if}

    <ScrollArea class="flex-1">
      {#if walletState.rpcError}
        <!-- Все токены с hasError: список нулей ничего не сообщает, показываем только ошибку выше. -->
      {:else if walletState.balances.length === 0}
        <p class="text-muted-foreground text-sm italic">{i18n.t('No balances found.')}</p>
      {:else}
        <div class="space-y-2">
          {#each walletState.balances as token (token.chainId + ':' + token.tokenAddress)}
            <div class="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                  {token.symbol.substring(0, 1)}
                </div>
                <div class="flex flex-col">
                  <span class="font-medium">{token.symbol}</span>
                  {#if token.hasError}
                    <span class="text-[10px] text-destructive">RPC error</span>
                  {/if}
                </div>
              </div>
              <span class="font-mono text-sm {token.hasError ? 'text-muted-foreground line-through' : ''}">
                {formatBalance(token.balance, token.decimals)}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </ScrollArea>

<!-- Панель действий -->
<div class="p-4 border-t border-border flex gap-2">
  <button onclick={() => alert('Send not implemented')} class="flex-1 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
    {i18n.t('Send')}
  </button>
  <button onclick={() => alert('Receive not implemented')} class="flex-1 py-2 border border-border rounded-md text-sm font-medium">
    {i18n.t('Receive')}
  </button>
  <button onclick={() => alert('Swap not implemented')} class="flex-1 py-2 border border-border rounded-md text-sm font-medium">
    {i18n.t('Swap')}
  </button>
</div>

  {/if}
</div>
