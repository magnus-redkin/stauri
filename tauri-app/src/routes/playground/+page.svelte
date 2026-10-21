<script lang="ts">
  import { PaneGroup, Pane, PaneResizer } from "paneforge";
  import {
    Home, User, Users, MessageCircle, Wallet, Store, Settings
  } from "lucide-svelte";
  import { onMount } from "svelte";
  import { i18n } from "$lib/i18n";

  // Импорт компонентов
  import ListSidebar from "$lib/modules/layout/ListSidebar.svelte";
  import WelcomeScreen from "$lib/modules/auth/WelcomeScreen.svelte";
  import SelectProfileScreen from "$lib/modules/auth/SelectProfileScreen.svelte";
  import MnemonicScreen from "$lib/modules/auth/MnemonicScreen.svelte";
  import CreateProfileScreen from "$lib/modules/auth/CreateProfileScreen.svelte";
  import RecoveryScreen from "$lib/modules/auth/RecoveryScreen.svelte";

  let activeSection = $state<"profile" | "contacts" | "chat" | "settings">("profile");

  // Состояния
  let isConnecting = $state(true);
  let isConnected = $state(false);
  let isLoggedIn = $state(false);
  let hasProfiles = $state(true); // Для теста показываем выбор профиля
  let displayName = $state("Tauri User");

  // Экран авторизации
  let authMode = $state<'welcome' | 'select' | 'mnemonic' | 'create' | 'recovery'>('welcome');

  onMount(() => {
    setTimeout(() => {
      isConnecting = false;
      isConnected = true;
    }, 1500);
    applyTheme(localStorage.getItem('stauri-theme') || 'maroon');
    applyFontSize(localStorage.getItem('stauri-font-size') || '16');
  });

  function applyTheme(newTheme: string) {
    document.documentElement.classList.remove('dark');
    document.documentElement.setAttribute('data-theme', newTheme);
    if (newTheme === 'dark') document.documentElement.classList.add('dark');
    localStorage.setItem('stauri-theme', newTheme);
  }

  function applyFontSize(size: string) {
    document.documentElement.style.fontSize = `${size}px`;
    localStorage.setItem('stauri-font-size', size);
  }

  function handleLogin() {
    isLoggedIn = true;
    activeSection = 'chat'; // После логина переходим в чат
  }
</script>

<div class="h-screen w-screen flex bg-background text-foreground overflow-hidden font-sans">

  <!-- 0. ICONS -->
  <nav class="w-16 flex flex-col items-center py-4 border-r border-border bg-secondary gap-2 shadow-sm z-10">
    <button class="p-3 rounded-lg hover:bg-black/5 text-muted-foreground transition-colors"><Home size={22} /></button>

    <button
      class="p-3 rounded-lg transition-colors {activeSection === 'profile' ? 'bg-primary text-primary-foreground shadow-md' : 'hover:bg-black/5 text-muted-foreground'}"
      onclick={() => activeSection = 'profile'}
    >
      <User size={22} />
    </button>

    <div class="w-8 h-px bg-border my-2"></div>

    <button class="p-3 rounded-lg transition-colors {activeSection === 'contacts' ? 'bg-primary text-primary-foreground shadow-md' : 'hover:bg-black/5 text-muted-foreground'}" onclick={() => activeSection = 'contacts'}><Users size={22} /></button>
    <button class="p-3 rounded-lg transition-colors {activeSection === 'chat' ? 'bg-primary text-primary-foreground shadow-md' : 'hover:bg-black/5 text-muted-foreground'}" onclick={() => activeSection = 'chat'}><MessageCircle size={22} /></button>

    <div class="w-8 h-px bg-border my-2"></div>

    <button class="p-3 rounded-lg hover:bg-black/5 text-muted-foreground transition-colors"><Wallet size={22} /></button>
    <button class="p-3 rounded-lg hover:bg-black/5 text-muted-foreground transition-colors"><Store size={22} /></button>
    <div class="flex-1"></div>
    <button class="p-3 rounded-lg transition-colors {activeSection === 'settings' ? 'bg-primary text-primary-foreground shadow-md' : 'hover:bg-black/5 text-muted-foreground'}" onclick={() => activeSection = 'settings'}><Settings size={22} /></button>
  </nav>

  <!-- ОСНОВНАЯ ОБЛАСТЬ -->
  <div class="flex-1 h-full overflow-hidden">
    <PaneGroup direction="horizontal" class="h-full">

      <!-- LIST -->
      <Pane defaultSize={30} minSize={20}>
        <ListSidebar
          {isConnecting} {isConnected} {isLoggedIn} {displayName} {activeSection}
          onConnect={() => { isConnecting = true; setTimeout(() => { isConnecting = false; isConnected = true; }, 1000); }}
          onDisconnect={() => { isConnected = false; }}
        />
      </Pane>

      <PaneResizer class="w-1 bg-border hover:bg-primary transition-colors cursor-col-resize" />

      <!-- MAIN -->
      <Pane defaultSize={70} class="flex flex-col bg-card overflow-y-auto">

        {#if isConnecting}
          <div class="h-full flex flex-col items-center justify-center gap-4">
            <div class="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p class="text-muted-foreground">Connecting to Status backend...</p>
          </div>

        {:else if isConnected && !isLoggedIn}
          <!-- ЭКРАНЫ АВТОРИЗАЦИИ -->
          {#if authMode === 'welcome'}
            <WelcomeScreen
              {hasProfiles}
              onCreate={() => authMode = 'mnemonic'}
              onRecovery={() => authMode = 'recovery'}
              onSelect={() => authMode = 'select'}
            />
          {:else if authMode === 'select'}
            <SelectProfileScreen
              onBack={() => authMode = 'welcome'}
              onLogin={handleLogin}
            />
          {:else if authMode === 'mnemonic'}
            <MnemonicScreen
              onBack={() => authMode = 'welcome'}
              onNext={() => authMode = 'create'}
            />
          {:else if authMode === 'create'}
            <CreateProfileScreen
              onBack={() => authMode = 'mnemonic'}
              onCreate={handleLogin}
            />
          {:else if authMode === 'recovery'}
            <RecoveryScreen
              onBack={() => authMode = 'welcome'}
              onLogin={handleLogin}
            />
          {/if}

        {:else if isLoggedIn}
          <!-- После логина -->
          <div class="p-8 max-w-2xl mx-auto w-full h-full flex flex-col items-center justify-center text-center">
            <h2 class="text-2xl font-bold text-primary mb-2">You are in!</h2>
            <p class="text-muted-foreground mb-8">Where do you want to go?</p>

            <div class="flex gap-4">
              <button onclick={() => activeSection = 'chat'} class="px-6 py-3 border border-border rounded-lg hover:bg-secondary font-medium transition-colors">Chat</button>
              <button class="px-6 py-3 border border-border rounded-lg hover:bg-secondary font-medium transition-colors opacity-50 cursor-not-allowed">Wallet</button>
              <button class="px-6 py-3 border border-border rounded-lg hover:bg-secondary font-medium transition-colors opacity-50 cursor-not-allowed">dApps</button>
            </div>
          </div>

        {:else}
           <div class="h-full flex items-center justify-center text-muted-foreground">
             Please connect to the backend.
           </div>
        {/if}
      </Pane>
    </PaneGroup>
  </div>
</div>
