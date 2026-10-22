<script lang="ts">
  import { i18n } from '$lib/i18n';

  let { onCreate, onRecovery, onSelect, hasProfiles }: {
    onCreate: () => void;
    onRecovery: () => void;
    onSelect: () => void;
    hasProfiles: boolean;
  } = $props();
</script>

<div class="max-w-md mx-auto w-full pt-12 px-6">
  <h2 class="text-3xl font-bold text-primary mb-2">Welcome</h2>
  <p class="text-muted-foreground mb-6">Create a new profile or log in with your recovery phrase.</p>

  {#if hasProfiles}
    <button onclick={onSelect} class="w-full h-12 mb-3 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors">
      Select Profile & Log in
    </button>
  {/if}

  <button onclick={onCreate} class="w-full h-12 mb-3 border border-border rounded-md font-medium hover:bg-secondary transition-colors text-left px-4">
    1. Create new profile
  </button>
  <button onclick={onRecovery} class="w-full h-12 border border-border rounded-md font-medium hover:bg-secondary transition-colors text-left px-4">
    2. Log in by recovery phrase
  </button>

  <div class="mt-8 p-4 bg-secondary/50 rounded-lg text-sm text-muted-foreground">
    <strong>NB:</strong> Unlike the official StatusIM client, Stauri allows you to create multiple independent profiles.
  </div>
</div>
