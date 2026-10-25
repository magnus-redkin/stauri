<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
  import { User } from "lucide-svelte";
  import { statusState } from '$lib/stores/statusStore.svelte';
  import NetworkInfo from './NetworkInfo.svelte';

  let { displayName = "Tauri User", onDisconnect }: { displayName?: string, onDisconnect?: () => void } = $props();

  let copiedProfileId = $state(false);
  let copiedPubKey = $state(false);

  async function copyProfileId() {
    if (!statusState.accountKeyUid) return;
    try {
      await navigator.clipboard.writeText(statusState.accountKeyUid);
      copiedProfileId = true;
      setTimeout(() => copiedProfileId = false, 2000);
    } catch (e) { console.error(e); }
  }

  async function copyPubKey() {
    if (!statusState.publicKey) return;
    try {
      await navigator.clipboard.writeText(statusState.publicKey);
      copiedPubKey = true;
      setTimeout(() => copiedPubKey = false, 2000);
    } catch (e) { console.error(e); }
  }
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border font-bold text-lg text-primary">
    {i18n.t('Profile')}
  </div>

  <ScrollArea class="flex-1 overflow-x-hidden">
    <!-- Connect Info -->
    <div class="p-4 border-b border-border bg-secondary/30">
      {#if statusState.isConnecting}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <div class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></div>
          {i18n.t('Connecting...')}
        </div>
      {:else if statusState.isConnected}
        <div class="flex items-center gap-2 text-green-600 font-semibold text-sm">
          <div class="w-2 h-2 rounded-full bg-green-500"></div>
          {i18n.t('Connected')} (Port: {statusState.backendPort})
        </div>
        <button
          onclick={onDisconnect}
          class="mt-1 text-xs text-red-500 hover:underline"
        >
          {i18n.t('Disconnect')}
        </button>

        <!-- Profile ID (внутренний, для логина) -->
        <div class="mt-3">
          <div class="text-[10px] font-bold text-muted-foreground uppercase">Profile ID</div>
          <button
            onclick={copyProfileId}
            class="mt-0.5 text-[10px] font-mono text-muted-foreground text-left hover:text-primary transition-colors cursor-pointer"
            title={i18n.t('Click to copy')}
          >
            {statusState.accountKeyUid ? statusState.accountKeyUid.substring(0, 6) + '...' : '...'}
            {#if copiedProfileId}<span class="ml-1 text-green-600 font-sans font-bold">✓ Copied!</span>{/if}
          </button>
        </div>

        <!-- Public Key (для чата) -->
        <div class="mt-2">
          <div class="text-[10px] font-bold text-muted-foreground uppercase">Public Key (for chat)</div>
          <button
            onclick={copyPubKey}
            class="mt-0.5 text-[10px] font-mono text-muted-foreground text-left hover:text-primary transition-colors cursor-pointer"
            title={i18n.t('Click to copy')}
          >
            {statusState.publicKey ? statusState.publicKey.substring(0, 6) + '...' : '(loading...)'}
            {#if copiedPubKey}<span class="ml-1 text-green-600 font-sans font-bold">✓ Copied!</span>{/if}
          </button>
        </div>

        <!-- Сетевая информация (RPC, Waku Fleet, Chain ID) -->
        <NetworkInfo />
      {:else}
        <button class="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
          {i18n.t('Connect')}
        </button>
      {/if}
    </div>

    <!-- Profile Info (только если залогинен) -->
    {#if statusState.isLoggedIn}
      <div class="p-4 flex flex-col items-center gap-3">
        <div class="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
          <User size={32} />
        </div>
        <div class="text-center">
          <!-- Используем alias вместо displayName -->
          <div class="font-bold text-lg">{statusState.alias || displayName}</div>
          <div class="text-xs text-muted-foreground">
            {statusState.accountKeyUid ? statusState.accountKeyUid.substring(0, 8) + '...' : ''}
          </div>
        </div>
        <button class="w-full mt-2 py-1.5 border border-border rounded-md text-sm hover:bg-secondary">
          {i18n.t('Edit Profile')}
        </button>
      </div>
    {/if}
  </ScrollArea>
</div>
