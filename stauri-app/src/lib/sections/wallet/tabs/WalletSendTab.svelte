<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { walletState } from '$lib/stores/walletStore.svelte';

  let selectedToken = $state('');
  let toAddress = $state('');
  let amount = $state('');

  const canReview = $derived(!!selectedToken && toAddress.trim().length > 0 && parseFloat(amount) > 0);
</script>

<div class="h-full flex flex-col p-6 overflow-auto">
  <h3 class="text-lg font-semibold mb-4">{i18n.t('Send')}</h3>

  <div class="space-y-4 max-w-md">
    <div>
      <label class="text-sm font-medium">{i18n.t('Token')}</label>
      <select
        bind:value={selectedToken}
        class="w-full h-10 border border-input rounded-md px-3 mt-1 bg-background"
      >
        <option value="">{i18n.t('Select token')}</option>
        {#each walletState.balances as token (token.chainId + ':' + token.tokenAddress)}
          <option value={token.chainId + ':' + token.tokenAddress}>
            {token.symbol} ({token.chainId})
          </option>
        {/each}
      </select>
    </div>

    <div>
      <label class="text-sm font-medium">{i18n.t('To')}</label>
      <input
        bind:value={toAddress}
        placeholder="0x..."
        class="w-full h-10 border border-input rounded-md px-3 mt-1 bg-background font-mono text-sm"
      />
    </div>

    <div>
      <label class="text-sm font-medium">{i18n.t('Amount')}</label>
      <input
        bind:value={amount}
        type="number"
        step="any"
        min="0"
        placeholder="0.0"
        class="w-full h-10 border border-input rounded-md px-3 mt-1 bg-background"
      />
    </div>

    <button
      disabled={!canReview}
      onclick={() => alert('Send not implemented yet')}
      class="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
    >
      {i18n.t('Review')}
    </button>
  </div>
</div>
