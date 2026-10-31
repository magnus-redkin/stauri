<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  // Сторы
  import {
    statusState,
    resetState,
    logout,
    setSeedSaved,
    setPendingRequestsCount
  } from '$lib/stores/statusStore.svelte';

  import {
    connectionState,
    connect,
    changeNetwork,
    login,
    createAccount,
    disconnect
  } from '$lib/stores/connectionStore.svelte';

  import { resetContacts } from '$lib/stores/contactsStore.svelte';
  import { chatsState, loadChats, selectChat, resetChats } from '$lib/stores/chatsStore.svelte';
  import {
    walletState,
    loadWallet,
    resetWallet,
    startWalletPolling,
    stopWalletPolling
  } from '$lib/stores/walletStore.svelte';

  // UI
  import { PaneGroup, Pane, PaneResizer } from "paneforge";
  import SidebarIcons from "$lib/sections/layout/SidebarIcons.svelte";
  import MainEntryScreen from "$lib/sections/auth/MainEntryScreen.svelte";
  import RecoveryScreen from '$lib/sections/auth/RecoveryScreen.svelte';

  import HomeMain from "$lib/sections/home/HomeMain.svelte";
  import ProfileLeft from "$lib/sections/profile/ProfileLeft.svelte";
  import EditProfile from "$lib/sections/profile/EditProfile.svelte";
  import CreateSeed from "$lib/sections/profile/CreateSeed.svelte";
  import ContactsLeft from "$lib/sections/contacts/ContactsLeft.svelte";
  import ContactsMain from "$lib/sections/contacts/ContactsMain.svelte";
  import SettingsLeft from "$lib/sections/settings/SettingsLeft.svelte";
  import SettingsMain from "$lib/sections/settings/SettingsMain.svelte";
  import WalletLeft from "$lib/sections/wallet/WalletLeft.svelte";
  import WalletMain from "$lib/sections/wallet/WalletMain.svelte";
  import MarketMain from "$lib/sections/market/MarketMain.svelte";
  import ChatLeft from "$lib/sections/chat/ChatLeft.svelte";
  import ChatMain from "$lib/sections/chat/ChatMain.svelte";


  // 🔥 ЖЕСТКИЙ ТЕСТ ЧТЕНИЯ .ENV НА СТОРОНЕ VITE
  const debugAlchemy = import.meta.env.VITE_ALCHEMY_KEY;
  const debugInfura = import.meta.env.VITE_INFURA_KEY;

  console.log("=========================================");
  console.log("🚨 [Vite ENV Verification]");
  console.log("VITE_ALCHEMY_KEY:", debugAlchemy ? "✅ НАЙДЕН (..." + debugAlchemy.slice(-5) + ")" : "❌ UNDEFINED!");
  console.log("VITE_INFURA_KEY:", debugInfura ? "✅ НАЙДЕН (..." + debugInfura.slice(-5) + ")" : "❌ UNDEFINED!");
  console.log("=========================================");

  if (!debugAlchemy || !debugInfura) {
    console.error("💥 КРИТИЧЕСКАЯ ОШИБКА: Vite не смог прочитать .env файл! Балансы кошелька не будут работать.");
  }


  // Навигация
  let activeSection = $state('home');
  let showRecovery = $state(false);
  let showCreateSeed = $state(false);

  // Выбор аккаунта для логина
  let selectedAccountKeyUid = $state('');
  let selectedNetwork = $state('mainnet');

  const hasProfiles = $derived(statusState.accounts.length > 0); // <-- Добавить

  // Ctrl+Q
  $effect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        getCurrentWindow().close();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // Реагируем на новые сообщения (через lastMessageSignal)
  $effect(() => {
    if (statusState.lastMessageSignal > 0 && activeSection === 'chat') {
      loadChats(true);
    }
  });

  // Сбрасываем CreateSeed при уходе с Profile
  $effect(() => {
    if (activeSection !== 'profile') {
      showCreateSeed = false;
    }
  });


  // wallet
  // fetchOrGetCachedWalletBalances читает кэш бэкенда (forceRefresh в status-go
  // игнорируется), поэтому балансы нужно перечитывать периодически.
  $effect(() => {
    if (statusState.isLoggedIn && activeSection === 'wallet') {
      loadWallet();
      startWalletPolling();
      return () => stopWalletPolling();
    }
    stopWalletPolling();
  });

  onMount(async () => {
    await connect(undefined);
    if (statusState.accounts.length > 0) {
      selectedAccountKeyUid = statusState.accounts[0]["key-uid"];
    }
  });

  async function handleNetworkChange(network: string) {
    await changeNetwork(network);
    selectedNetwork = network;
  }

  async function handleLogin(password: string) {
    if (!selectedAccountKeyUid) return;
    try {
      await login(password, selectedAccountKeyUid);
      activeSection = 'home';
    } catch (e: any) {
      statusState.errorMsg = `Login failed: ${e.message}`;
    }
  }

  async function handleCreateAccount(password: string) {
    try {
      await createAccount(password);
      // После создания аккаунт автоматически логинится (через waitForLogin)
      if (statusState.accounts.length > 0) {
        selectedAccountKeyUid = statusState.accounts[0]["key-uid"];
      }
      activeSection = 'home';
    } catch (e: any) {
      statusState.errorMsg = `Create account failed: ${e.message}`;
    }
  }

  function handleOpenChat(chatId: string) {
    activeSection = 'chat';
    selectChat(chatId);
  }

  async function handleDisconnect() {
    await logout();
    await disconnect();
    resetState();
    resetContacts();
    resetChats();
    resetWallet();
    setPendingRequestsCount(0);
    showCreateSeed = false;
    selectedAccountKeyUid = '';
    activeSection = 'home';
    await connect(undefined);
    if (statusState.accounts.length > 0) {
      selectedAccountKeyUid = statusState.accounts[0]["key-uid"];
    }
  }
</script>

<div class="min-h-screen bg-background">
  <!-- Плашка Testnet -->
  {#if statusState.isTestnet}
    <div class="bg-orange-500 text-white text-center py-2 px-4 font-semibold text-sm">
      ⚠️ {statusState.networkName.toUpperCase()} TESTNET MODE — All balances and transactions are on testnets.
    </div>
  {/if}

  <!-- Спиннер -->
  {#if connectionState.isConnecting}
    <div class="flex flex-col items-center justify-center min-h-screen gap-4">
      <div class="w-10 h-10 border-4 border-muted border-t-primary rounded-full animate-spin"></div>
      <h2 class="text-2xl font-semibold text-foreground">Connecting...</h2>
    </div>

  <!-- Экран входа -->
  {:else if !statusState.isLoggedIn}
    {#if showRecovery}
      <RecoveryScreen
        onBack={() => showRecovery = false}
        onLogin={() => {
          alert("Recovery not implemented yet.");
          showRecovery = false;
        }}
      />
    {:else}
      <MainEntryScreen
        onLogin={handleLogin}
        onCreate={handleCreateAccount}
        onRecovery={() => showRecovery = true}
        onNetworkChange={handleNetworkChange}
        {hasProfiles}
        bind:selectedAccountKeyUid
        bind:selectedNetwork
      />
    {/if}

  <!-- Основной интерфейс -->
  {:else}
    <div class="flex h-screen overflow-hidden">
      <SidebarIcons bind:activeSection />

      <PaneGroup direction="horizontal" class="h-full w-full">
        <!-- LEFT PANEL -->
        <Pane defaultSize={30} minSize={20} class="h-full overflow-hidden border-r border-border">
          {#if activeSection === 'home' || activeSection === 'profile'}
            <ProfileLeft
              onDisconnect={handleDisconnect}
              onCreateSeed={() => { activeSection = 'profile'; showCreateSeed = true; }}
            />
          {:else if activeSection === 'contacts'}
            <ContactsLeft />
          {:else if activeSection === 'settings'}
            <SettingsLeft />
          {:else if activeSection === 'wallet'}
            <WalletLeft onNavigate={(s) => activeSection = s} />
          {:else if activeSection === 'chat'}
            <ChatLeft onSelectChat={(chat) => selectChat(chat.id)} />
          {:else}
            <ProfileLeft
              onDisconnect={handleDisconnect}
              onCreateSeed={() => { activeSection = 'profile'; showCreateSeed = true; }}
            />
          {/if}
        </Pane>

        <PaneResizer class="w-1 bg-border hover:bg-primary transition-colors cursor-col-resize" />

        <!-- MAIN PANEL -->
        <Pane defaultSize={70} class="h-full bg-card">
          {#if activeSection === 'home'}
            <HomeMain onNavigate={(s) => activeSection = s} />
          {:else if activeSection === 'profile'}
            {#if showCreateSeed}
              <CreateSeed
                onBack={() => showCreateSeed = false}
                onSave={() => {
                  setSeedSaved(true);
                  showCreateSeed = false;
                }}
              />
            {:else}
              <EditProfile onNavigate={(s) => activeSection = s} />
            {/if}
          {:else if activeSection === 'contacts'}
            <ContactsMain onOpenChat={handleOpenChat} />
          {:else if activeSection === 'settings'}
            <SettingsMain />
          {:else if activeSection === 'wallet'}
            <WalletMain />
          {:else if activeSection === 'market'}
            <MarketMain />
          {:else if activeSection === 'chat'}
            <ChatMain />
          {:else}
            <HomeMain onNavigate={(s) => activeSection = s} />
          {/if}
        </Pane>
      </PaneGroup>
    </div>
  {/if}
</div>
