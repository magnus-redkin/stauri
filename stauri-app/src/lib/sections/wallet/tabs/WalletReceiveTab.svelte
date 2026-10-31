<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { walletState } from '$lib/stores/walletStore.svelte';

  let copied = $state(false);

  async function copyAddress() {
    if (!walletState.address) return;
    try {
      await navigator.clipboard.writeText(walletState.address);
      copied = true;
      setTimeout(() => copied = false, 2000);
    } catch (e) { console.error(e); }
  }

  const qrUrl = $derived(
    walletState.address
      ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(walletState.address)}`
      : ''
  );
</script>

<div class="h-full flex flex-col p-6 overflow-auto">
  <h3 class="text-lg font-semibold mb-4">{i18n.t('Receive')}</h3>

  {#if !walletState.address}
    <p class="text-muted-foreground text-sm">{i18n.t('No wallet address')}</p>
  {:else}
    <div class="flex flex-col items-center gap-4 max-w-md">
      {#if qrUrl}
        <img src={qrUrl} alt="QR" class="w-48 h-48 rounded-lg border border-border" />
      {/if}

      <div class="w-full">
        <label class="text-sm font-medium">{i18n.t('Your address')}</label>
        <div class="mt-1 flex gap-2">
          <input
            readonly
            value={walletState.address}
            class="flex-1 h-10 border border-input rounded-md px-3 bg-secondary font-mono text-xs"
          />
          <button
            onclick={copyAddress}
            class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium"
          >
            {copied ? i18n.t('Copied!') : i18n.t('Copy')}
          </button>
        </div>
      </div>

      <p class="text-xs text-muted-foreground text-center">
        {i18n.t('Send only supported tokens to this address.')}
      </p>
    </div>
  {/if}
</div>
