<script lang="ts">
  let { onBack, onLogin }: { onBack: () => void; onLogin: () => void } = $props();
  let selectedProfile = $state("0x0c388716a4b1a448ba1157decf9c4c48208b878f3ffdae205d9a1a09ba94bc4f");
  let password = $state("");
</script>

<div class="max-w-md mx-auto w-full pt-12 px-6">
  <button onclick={onBack} class="text-sm text-muted-foreground hover:underline mb-4">← Back</button>
  <h2 class="text-2xl font-bold text-primary mb-4">Select Profile</h2>

  <select bind:value={selectedProfile} class="w-full h-12 border border-border rounded-md px-3 bg-background mb-4">
    <option value="0x0c388716a4b1a448ba1157decf9c4c48208b878f3ffdae205d9a1a09ba94bc4f">Tauri User (0x0c38...)</option>
    <option value="0xd83a85947f74560c2d2833be586a9748bcba63c0d9eda67138979f157d93a036">Tauri User (0xd83a...)</option>
  </select>

  <input type="password" placeholder="Password" bind:value={password} class="w-full h-12 border border-border rounded-md px-3 mb-4" />
  <button onclick={onLogin} class="w-full h-12 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90">Log In</button>
</div>
