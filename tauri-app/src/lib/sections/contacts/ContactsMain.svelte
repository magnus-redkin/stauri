<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { onMount } from 'svelte';
  import * as Card from "$lib/components/ui/card/index.js";

  let keyInput: HTMLInputElement;
  onMount(() => keyInput?.focus());

</script>

<div class="p-6 max-w-md mx-auto w-full h-full overflow-y-auto">
  <h2 class="text-2xl font-bold text-primary mb-6">{i18n.t('Contact Details')}</h2>

  <Card.Root class="border-border shadow-sm mb-6">
    <Card.Header class="bg-secondary rounded-t-lg border-b border-border">
      <Card.Title class="text-primary">{i18n.t('Send Contact Request')}</Card.Title>
      <Card.Description class="text-muted-foreground">{i18n.t('Enter a public key to connect')}</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-4 pt-4">
      <input
        bind:this={keyInput}
        type="text"
        placeholder="0x..."
        class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
      />
      <button class="w-full bg-primary text-primary-foreground h-10 rounded-md font-medium hover:bg-primary/90 transition-colors">{i18n.t('Send Request')}</button>
    </Card.Content>
  </Card.Root>

  <div class="p-4 border border-border rounded-lg bg-secondary">
    <p class="text-sm text-muted-foreground italic">{i18n.t('Pending requests and contact info will appear here.')}</p>
  </div>
</div>
