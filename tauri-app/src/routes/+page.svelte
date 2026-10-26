<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import WebSocket from '@tauri-apps/plugin-websocket';

  import {
    statusState,
    processSignal,
    resetState,
    setAccounts,
    setNetworkInfo,
    setPendingRequestsCount,
    logout,
    waitForLogin,
    setSeedSaved
  } from '$lib/stores/statusStore.svelte';

  import {
    startBackend,
    stopBackend,
    initializeApplication,
    loginAccount,
    createAccountAndLogin,
    getChats as apiGetChats,
    getContacts
  } from '$lib/status/api';

  import { getDisplayName } from '$lib/utils/user';

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
  import ChatLeft, { type ChatItem } from "$lib/sections/chat/ChatLeft.svelte";
  import ChatMain from "$lib/sections/chat/ChatMain.svelte";

  let activeSection = $state('home');
  let ws: WebSocket | null = null;
  let selectedAccountKeyUid = $state('');
  let hasProfiles = $state(false);
  let selectedNetwork = $state('mainnet');
  let showRecovery = $state(false);
  let showCreateSeed = $state(false);

  let chats = $state<ChatItem[]>([]);
  let allContacts = $state<any[]>([]);
  let selectedChat = $state<ChatItem | null>(null);
  let selectedContact = $state<any>(null);

  // Флаг, предотвращающий бесконечный цикл загрузки чатов
  let chatsLoaded = $state(false);

  $effect(() => {
    if (activeSection !== 'profile') {
      showCreateSeed = false;
    }
  });

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

  // Реагируем на новые сообщения (если мы на вкладке чата)
  $effect(() => {
    if (statusState.isLoggedIn && activeSection === 'chat' && !chatsLoaded) {
      loadChatsAndRequests();
    }
    // Если ушли с вкладки Chat, сбрасываем флаг, чтобы при возврате загрузить заново
    if (activeSection !== 'chat') {
      chatsLoaded = false;
    }
  });

  onMount(async () => {
    // Передаем undefined, чтобы Rust взял сеть из конфига (или mainnet по умолчанию)
    await loadAccountsForNetwork(undefined);
  });

  async function loadAccountsForNetwork(network?: string) {
    if (statusState.isConnecting) return;

    if (statusState.backendPort) {
      try { await stopBackend(); } catch (e) { console.warn("stopBackend failed:", e); }
      await new Promise(r => setTimeout(r, 500));
      statusState.isConnected = false;
      statusState.backendPort = null;
    }

    statusState.isConnecting = true;
    statusState.errorMsg = '';

    try {
      const backendInfo = await startBackend(network);
      statusState.backendPort = backendInfo.port;
      statusState.backendDataDir = backendInfo.dataDir;

      // Обновляем локальное состояние сети
      selectedNetwork = backendInfo.networkName;

      await new Promise(resolve => setTimeout(resolve, 1500));

      const initData = await initializeApplication(
        statusState.backendPort,
        statusState.backendDataDir,
        backendInfo.chainId
      );

      if (initData.accounts && initData.accounts.length > 0) {
        setAccounts(initData.accounts);
        selectedAccountKeyUid = initData.accounts[0]["key-uid"];
        hasProfiles = true;
      } else {
        setAccounts([]);
        selectedAccountKeyUid = '';
        hasProfiles = false;
      }

      setNetworkInfo(
        backendInfo.networkName,
        backendInfo.rpcUrl,
        backendInfo.wakuFleet,
        backendInfo.isTestnet,
        backendInfo.chainId
      );

      statusState.isConnected = true;
    } catch (e: any) {
      statusState.errorMsg = `Failed to load accounts: ${e?.message || e}`;
      statusState.isConnected = false;
      statusState.backendPort = null;
    } finally {
      statusState.isConnecting = false;
    }
  }

  async function handleNetworkChange(network: string) {
    await loadAccountsForNetwork(network);
  }

  async function reconnectWs(port: number) {
    if (ws) {
      try { await ws.disconnect(); } catch (e) { console.warn("ws.disconnect failed:", e); }
      ws = null;
    }
    ws = await WebSocket.connect(`ws://127.0.0.1:${port}/signals`);
    ws.addListener((msg) => processSignal(msg.data));
  }

  async function handleLogin(loginPassword: string) {
    if (!statusState.backendPort || !loginPassword || !selectedAccountKeyUid) return;

    try {
      // Подключаем WS (если еще не подключен)
      if (!ws) await reconnectWs(statusState.backendPort);

      await loginAccount(statusState.backendPort, loginPassword, selectedAccountKeyUid);

      // Ждем сигнал node.login (до 30 сек)
      await waitForLogin(30000);

      activeSection = 'home';
    } catch (e: any) {
      statusState.errorMsg = `Login failed: ${e.message}`;
    }
  }

  async function handleCreateAccount(newPassword: string) {
    if (!statusState.backendPort) {
      await loadAccountsForNetwork(selectedNetwork);
    }

    if (statusState.backendPort && statusState.backendDataDir) {
      statusState.isConnecting = true;
      try {
        // Подключаем WS заранее
        if (!ws) await reconnectWs(statusState.backendPort);

        const createResult = await createAccountAndLogin(
          statusState.backendPort,
          statusState.backendDataDir,
          newPassword
        );

        if (createResult?.error) throw new Error(createResult.error);

        // Ждем сигнал node.login (до 30 сек)
        await waitForLogin(30000);

        hasProfiles = true;
        activeSection = 'home';
      } catch (e: any) {
        statusState.errorMsg = `Create account failed: ${e.message}`;
      } finally {
        statusState.isConnecting = false;
      }
    }
  }

  async function loadChatsAndRequests(force = false) {
    if (!statusState.backendPort) return;
    if (chatsLoaded && !force) return; // Предотвращаем бесконечный цикл

    try {
      const chatsRes = await apiGetChats(statusState.backendPort);
      const rawChats = chatsRes.result || [];

      const contactsRes = await getContacts(statusState.backendPort);
      allContacts = contactsRes.result || [];

      chats = rawChats.map((c: any) => {
        const contact = allContacts.find((ct: any) => ct.id === c.id);
        const name = contact ? getDisplayName(contact) : getDisplayName(c);

        return {
          id: c.id,
          name,
          lastMessage: c.lastMessage?.text || '',
          type: 'status' as const,
          isPendingRequest: c.active === false && c.lastMessage?.contactRequestState === 1,
        };
      });

      const pendingCount = chats.filter(c => c.isPendingRequest).length;
      setPendingRequestsCount(pendingCount);

      chatsLoaded = true; // Загрузка завершена
    } catch (e) {
      console.warn("Failed to load chats:", e);
    }
  }

  async function handleDisconnect() {
    if (ws) {
      try { await ws.disconnect(); } catch (e) { console.warn("ws.disconnect failed:", e); }
      ws = null;
    }

    // Logout перед убийством бэкенда
    await logout();

    try {
      await stopBackend();
    } catch (e) {
      console.warn("Failed to stop backend:", e);
    }

    await new Promise(r => setTimeout(r, 500));
    resetState();

    // Сбрасываем локальные флаги
    hasProfiles = false;
    selectedAccountKeyUid = '';
    chatsLoaded = false;
    chats = [];
    selectedChat = null;

    // Перезапускаем для Mainnet (или из конфига)
    await loadAccountsForNetwork(undefined);
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
  {#if statusState.isConnecting}
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
              onCreateSeed={() => {
              console.log("onCreateSeed called, setting showCreateSeed = true");
              activeSection = 'profile'; // <-- Переключаем на профиль
              showCreateSeed = true;
              }}

              />
          {:else if activeSection === 'contacts'}
            <ContactsLeft
              onSelectContact={(c) => selectedContact = c}
              onAddContact={() => selectedContact = null}
              />
          {:else if activeSection === 'settings'}
            <SettingsLeft />
          {:else if activeSection === 'wallet'}
            <WalletLeft onNavigate={(s) => activeSection = s} />
          {:else if activeSection === 'chat'}
            <ChatLeft
              items={chats}
              selectedChatId={selectedChat?.id || null}
              onSelectChat={(item) => selectedChat = item}
              />
          {:else}
            <ProfileLeft onDisconnect={handleDisconnect} />
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
              <ContactsMain
                selectedContact={selectedContact}
                onClearSelection={() => selectedContact = null}
                />
          {:else if activeSection === 'settings'}
            <SettingsMain />
          {:else if activeSection === 'wallet'}
            <WalletMain />
          {:else if activeSection === 'market'}
            <MarketMain />
          {:else if activeSection === 'chat'}
            <ChatMain
              chat={selectedChat}
              contacts={allContacts}
              onRefresh={() => loadChatsAndRequests(true)}
            />
          {:else}
            <HomeMain />
          {/if}
        </Pane>
      </PaneGroup>
    </div>
  {/if}
</div>
