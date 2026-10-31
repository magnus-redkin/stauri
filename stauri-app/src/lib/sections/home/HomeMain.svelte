<script lang="ts">
  import { i18n } from '$lib/i18n';
  let { onNavigate }: { onNavigate?: (section: string) => void } = $props();
</script>

<div class="h-full flex flex-col items-center justify-center bg-card gap-6">
  <h1 class="text-3xl font-bold text-primary">{i18n.t('Welcome to Stauri')}</h1>
  <div class="flex gap-4">
    <button onclick={() => onNavigate?.('chat')} class="px-6 py-3 border border-border rounded-lg hover:bg-secondary">Chat</button>
    <button onclick={() => onNavigate?.('wallet')} class="px-6 py-3 border border-border rounded-lg hover:bg-secondary">Wallet</button>
  </div>
</div>
