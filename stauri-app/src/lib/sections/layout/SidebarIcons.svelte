<script lang="ts">
  import { Home, User, Users, MessageCircle, Wallet, Store, Settings, Blocks } from "lucide-svelte";
  import { i18n } from '$lib/i18n';
  import { statusState } from '$lib/stores/statusStore.svelte'; // <-- Импорт стора

  let {
    activeSection = $bindable(),
    onSelect,
  }: {
    activeSection: string;
    /**
     * Вызывается при любом клике, включая повторный по уже активной вкладке.
     *
     * Без этого «нажал на свою же иконку» не делает ничего: `activeSection`
     * не меняется, и эффекты, следящие за ней, не срабатывают. Разделу dApps
     * это нужно — повторный клик возвращает к началу компонента.
     */
    onSelect?: (id: string) => void;
  } = $props();

  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'profile', icon: User, label: 'Profile' },
    { id: 'contacts', icon: Users, label: 'Contacts' },
    { id: 'chat', icon: MessageCircle, label: 'Chat' },
    // Отдельного раздела «Сообщества» больше нет.
    //
    // Просмотр каталога сообществ — это провайдер по нашей терминологии
    // (docs/ru/providers_and_dapps.md): он отдаёт список адресов, а
    // подключение выполняем мы. Такие вещи живут в разделе dApp, чтобы не
    // занимать место в основной навигации рядом с тем, что у пользователя
    // уже есть.
    { id: 'dapps', icon: Blocks, label: 'dApps' },
    { id: 'wallet', icon: Wallet, label: 'Wallet' },
    { id: 'market', icon: Store, label: 'Market' },
  ];
</script>

<nav class="w-16 flex flex-col items-center py-4 border-r border-border bg-secondary gap-2 shadow-sm z-20 relative">
  {#each navItems as item (item.id)}
    <div class="relative group">
      <button
        class="p-3 rounded-lg transition-colors {activeSection === item.id ? 'bg-primary text-primary-foreground shadow-md' : 'hover:bg-black/5 text-muted-foreground'}"
        onclick={() => { activeSection = item.id; onSelect?.(item.id); }}
      >
        <item.icon size={22} />

        <!-- Красный бейдж для Chat -->
        {#if item.id === 'chat' && statusState.pendingRequestsCount > 0}
          <span class="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[0.625rem] font-bold text-white">
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
      onclick={() => { activeSection = 'settings'; onSelect?.('settings'); }}
    >
      <Settings size={22} />
    </button>
    <div class="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-3 py-1.5 bg-popover text-popover-foreground text-sm font-medium rounded-md shadow-lg border border-border opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
      Settings
    </div>
  </div>
</nav>
