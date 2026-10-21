<script lang="ts">
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { User } from "lucide-svelte";

  let {
    isConnecting, isConnected, isLoggedIn, displayName, activeSection,
    onConnect, onDisconnect
  }: any = $props();
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border font-bold text-lg text-primary">
    {activeSection === 'profile' ? 'My Profile' : 'Contacts'}
  </div>

  <ScrollArea class="flex-1">
    <!-- Блок коннекта -->
    <div class="p-4 border-b border-border bg-secondary/30">
      {#if isConnecting}
        <div class="flex items-center gap-2 text-sm">
          <div class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></div>
          Connecting...
        </div>
      {:else if isConnected}
        <div class="flex items-center gap-2 text-green-600 font-semibold text-sm">
          <div class="w-2 h-2 rounded-full bg-green-500"></div>
          Connected (Port: 33835)
        </div>
        <button onclick={onDisconnect} class="mt-1 text-xs text-red-500 hover:underline">Disconnect</button>
        <div class="mt-2 text-[10px] font-mono text-muted-foreground break-all">
          PubKey: 0x0450...ba3d
        </div>
      {:else}
        <button onclick={onConnect} class="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90">Connect</button>
      {/if}
    </div>

    <!-- Блок профиля (если вошли) -->
    {#if isLoggedIn && activeSection === 'profile'}
      <div class="p-4 border-b border-border flex flex-col items-center gap-3">
        <div class="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
          <User size={32} />
        </div>
        <div class="text-center">
          <div class="font-bold text-lg text-foreground">{displayName || "Tauri User"}</div>
          <div class="text-xs text-muted-foreground">0x0c38...c4b1</div>
        </div>
        <button class="w-full mt-2 py-1.5 border border-border rounded-md text-sm hover:bg-secondary">Edit Profile</button>
      </div>
    {/if}

    <!-- Список контактов (если открыты контакты) -->
    {#if activeSection === 'contacts' && isLoggedIn}
      <div class="p-2 space-y-1">
        {#each [{ name: "Alice", key: "0x123..." }, { name: "Bob", key: "0x456..." }] as contact}
          <button class="w-full text-left p-3 rounded-md hover:bg-secondary flex flex-col">
            <span class="font-medium">{contact.name}</span>
            <span class="text-xs text-muted-foreground font-mono">{contact.key}</span>
          </button>
        {/each}
      </div>
    {/if}
  </ScrollArea>
</div>
