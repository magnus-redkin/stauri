<script lang="ts">
  let { onBack, onLogin }: { onBack: () => void; onLogin: () => void } = $props();
  let words = $state(Array(12).fill(""));
  let password = $state("");

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && password) {
      onLogin();
    }
  }
</script>

<div class="max-w-md mx-auto w-full pt-12 px-6">
  <button onclick={onBack} class="text-sm text-muted-foreground hover:underline mb-4">← Back</button>
  <h2 class="text-2xl font-bold text-primary mb-2">Log in by Recovery Phrase</h2>
  <p class="text-sm text-muted-foreground mb-4">Enter your 12 words in the correct order.</p>

  <div class="grid grid-cols-2 gap-2 mb-6">
    {#each words as word, i}
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{i + 1}.</span>
        <input
          type="text"
          bind:value={words[i]}
          class="w-full h-10 border border-border rounded-md pl-8 pr-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
    {/each}
  </div>

  <input
    type="password"
    placeholder="Password"
    bind:value={password}
    onkeydown={handleKeydown}
    class="w-full h-12 border border-border rounded-md px-3 mb-4"
  />

  <button onclick={onLogin} class="w-full h-12 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90">
    Log In
  </button>
</div>
