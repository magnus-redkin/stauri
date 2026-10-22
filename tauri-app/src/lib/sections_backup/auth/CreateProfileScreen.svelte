<script lang="ts">
  let { onBack, onCreate }: { onBack: () => void; onCreate: () => void } = $props();
  let password = $state("");
  let confirmPassword = $state("");
  let displayName = $state("");

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && password && confirmPassword) {
      onCreate();
    }
  }
</script>


<div class="max-w-md mx-auto w-full pt-12 px-6">
  <button onclick={onBack} class="text-sm text-muted-foreground hover:underline mb-4">← Back</button>
  <h2 class="text-2xl font-bold text-primary mb-4">Create Profile</h2>

  <input type="password" placeholder="New Password" bind:value={password} class="w-full h-12 border border-border rounded-md px-3 mb-3" />
  <input type="password" placeholder="Confirm Password" bind:value={confirmPassword} class="w-full h-12 border border-border rounded-md px-3 mb-3" />
    <input
    type="text"
    placeholder="Display Name"
    bind:value={displayName}
    onkeydown={handleKeydown}
    class="w-full h-12 border border-border rounded-md px-3 mb-6"
  />

  <div class="flex items-center gap-4 mb-6">
    <div class="w-16 h-16 rounded-full bg-secondary flex items-center justify-center border border-border">
      <!-- Иконка User -->
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    </div>
    <button class="text-sm text-primary hover:underline">Upload Userpic</button>
  </div>

  <button onclick={onCreate} class="w-full h-12 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90">
    Create Profile
  </button>
</div>
