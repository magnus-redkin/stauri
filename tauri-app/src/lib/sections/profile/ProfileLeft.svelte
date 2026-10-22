<script lang="ts">
  import { i18n } from '$lib/i18n';

  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { User } from "lucide-svelte";
  let { isConnecting, isConnected, isLoggedIn, displayName }: any = $props();
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border font-bold text-lg text-primary">{i18n.t('Profile')}</div>
  <ScrollArea class="flex-1">
    <!-- Connect Info -->
    <div class="p-4 border-b border-border bg-secondary/30">
      {#if isConnecting}
        <div class="flex items-center gap-2 text-sm text-muted-foreground"><div class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></div>{i18n.t('Connecting...')}</div>
      {:else if isConnected}
        <div class="flex items-center gap-2 text-green-600 font-semibold text-sm"><div class="w-2 h-2 rounded-full bg-green-500"></div> Connected (Port: 33835)</div>
        <button class="mt-1 text-xs text-red-500 hover:underline">{i18n.t('Disconnect')}</button>
      {:else}
        <button class="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">{i18n.t('Connect')}</button>
      {/if}
    </div>

    <!-- Profile Info -->
    {#if isLoggedIn}
      <div class="p-4 flex flex-col items-center gap-3">
        <div class="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary"><User size={32} /></div>
        <div class="text-center">
          <div class="font-bold text-lg">{displayName || "Tauri User"}</div>
          <div class="text-xs text-muted-foreground">0x0c38...c4b1</div>
        </div>
        <button class="w-full mt-2 py-1.5 border border-border rounded-md text-sm hover:bg-secondary">{i18n.t('Edit Profile')}</button>
      </div>
    {/if}
  </ScrollArea>
</div>
