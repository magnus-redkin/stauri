<script lang="ts">
  import { Home, User, Users, MessageCircle, Wallet, Store, Settings } from "lucide-svelte";
  import { i18n } from '$lib/i18n';
  import { statusState } from '$lib/stores/statusStore.svelte'; // <-- Импорт стора

  let { activeSection = $bindable() }: { activeSection: string } = $props();

  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'profile', icon: User, label: 'Profile' },
    { id: 'contacts', icon: Users, label: 'Contacts' },
    { id: 'chat', icon: MessageCircle, label: 'Chat' },
    { id: 'wallet', icon: Wallet, label: 'Wallet' },
    { id: 'market', icon: Store, label: 'Market' },
  ];
</script>

<nav class="w-16 flex flex-col items-center py-4 border-r border-border bg-secondary gap-2 shadow-sm z-20 relative">
  {#each navItems as item}
    <div class="relative group">
      <button
        class="p-3 rounded-lg transition-colors {activeSection === item.id ? 'bg-primary text-primary-foreground shadow-md' : 'hover:bg-black/5 text-muted-foreground'}"
        onclick={() => activeSection = item.id}
      >
        <item.icon size={22} />

        <!-- Красный бейдж для Chat -->
        {#if item.id === 'chat' && statusState.pendingRequestsCount > 0}
          <span class="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {statusState.pendingRequestsCount}
          </span>
        {/if}
      </button>

      <!-- Tooltip -->
      <div class="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-3 py-1.5 bg-popover text-popover-foreground text-sm font-medium rounded-md shadow-lg border border-border opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
        {item.label}
      </div>
    </div>
  {/each}

  <div class="flex-1"></div>

  <!-- Settings -->
  <div class="relative group">
    <button
      class="p-3 rounded-lg transition-colors {activeSection === 'settings' ? 'bg-primary text-primary-foreground shadow-md' : 'hover:bg-black/5 text-muted-foreground'}"
      onclick={() => activeSection = 'settings'}
    >
      <Settings size={22} />
    </button>
    <div class="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-3 py-1.5 bg-popover text-popover-foreground text-sm font-medium rounded-md shadow-lg border border-border opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
      Settings
    </div>
  </div>
</nav>
