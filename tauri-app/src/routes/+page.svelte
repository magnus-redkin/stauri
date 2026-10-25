<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import WebSocket from '@tauri-apps/plugin-websocket';

  import {
    statusState,
    processSignal,
    resetState,
    setAccounts,
    setNetworkInfo
  } from '$lib/stores/statusStore.svelte';

  import { setPendingRequestsCount } from '$lib/stores/statusStore.svelte';

  import {
    startBackend,
    stopBackend,
    initializeApplication,
    loginAccount,
    createAccountAndLogin
  } from '$lib/status/api';

  import { PaneGroup, Pane, PaneResizer } from "paneforge";
  import SidebarIcons from "$lib/sections/layout/SidebarIcons.svelte";

  import MainEntryScreen from "$lib/sections/auth/MainEntryScreen.svelte";
  import HomeLeft from "$lib/sections/home/HomeLeft.svelte";
  import HomeMain from "$lib/sections/home/HomeMain.svelte";
  import ProfileLeft from "$lib/sections/profile/ProfileLeft.svelte"; // <-- Добавить
  import ProfileMain from "$lib/sections/profile/ProfileMain.svelte";
  import ContactsLeft from "$lib/sections/contacts/ContactsLeft.svelte";
  import ContactsMain from "$lib/sections/contacts/ContactsMain.svelte";
  import SettingsLeft from "$lib/sections/settings/SettingsLeft.svelte";
  import SettingsMain from "$lib/sections/settings/SettingsMain.svelte";
  import WalletLeft from "$lib/sections/wallet/WalletLeft.svelte";
  import WalletMain from "$lib/sections/wallet/WalletMain.svelte";
  import MarketMain from "$lib/sections/market/MarketMain.svelte";
  import RecoveryScreen from '$lib/sections/auth/RecoveryScreen.svelte';


  import ChatLeft, { type ChatItem } from '$lib/sections/chat/ChatLeft.svelte';
  import ChatMain from '$lib/sections/chat/ChatMain.svelte';

  let chats = $state<ChatItem[]>([]);
  let selectedChat = $state<ChatItem | null>(null);

  let selectedChatId = $state<string | null>(null);

  let currentNetwork = $state('mainnet'); // Текущая сеть, для которой запущен бэкенд

  let activeSection = $state('home');
  let ws: WebSocket | null = null;
  let selectedAccountKeyUid = $state('');
  let hasProfiles = $state(false);
  let password = $state('');
  let selectedNetwork = $state('mainnet'); // <-- Добавляем сеть

  let showRecovery = $state(false);
  let allContacts = $state<any[]>([]);


  $effect(() => {
    // Отслеживаем lastMessageSignal
    if (statusState.lastMessageSignal > 0 && activeSection === 'chat') {
      loadChatsAndRequests();
    }
  });

  // Ctrl+Q (без изменений)
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

  onMount(async () => {
    // Загружаем аккаунты для Mainnet по умолчанию
    await loadAccountsForNetwork('mainnet');
  });


  import { getChats as apiGetChats, getContacts } from '$lib/status/api';
  import { getDisplayName } from '$lib/utils/user';



  async function loadChatsAndRequests() {
    if (!statusState.backendPort) return;

    try {
      // 1. Загружаем чаты
      const chatsRes = await apiGetChats(statusState.backendPort);
      const rawChats = chatsRes.result || [];

      // 2. Загружаем контакты (для получения alias/displayName)
      const contactsRes = await getContacts(statusState.backendPort);
      allContacts = contactsRes.result || [];

      // 3. Маппим чаты, подставляя имя из контактов (если есть)
      chats = rawChats.map((c: any) => {
        // Ищем контакт по id чата (для личных чатов id = публичный ключ собеседника)
        const contact = allContacts.find((ct: any) => ct.id === c.id);

        // Определяем имя: если есть контакт — берём из него, иначе из чата
        const name = contact ? getDisplayName(contact) : getDisplayName(c);

        // Определяем, является ли чат входящим запросом
        const isPendingRequest = c.active === false && c.lastMessage?.contactRequestState === 1;

        return {
          id: c.id,
          name,
          lastMessage: c.lastMessage?.text || '',
          type: 'status' as const,
          isPendingRequest,
        };
      });

      // 4. Обновляем счётчик pending-запросов для бейджа на иконке Chat
      const pendingCount = chats.filter(c => c.isPendingRequest).length;
      setPendingRequestsCount(pendingCount);

      console.log("🟢 Chats loaded:", chats.length, "Pending:", pendingCount);
      console.log("🔵 Raw chats:", rawChats.map(c => ({ id: c.id, name: c.name, alias: c.alias })));
      console.log("🟣 Contacts:", allContacts.map(c => ({ id: c.id, alias: c.alias, displayName: c.displayName })));
    } catch (e: any) {
      console.error("Failed to load chats/requests:", e);
      statusState.errorMsg = `Failed to load chats: ${e?.message || e}`;
    }
  }


  $effect(() => {
    if (statusState.isLoggedIn && activeSection === 'chat' && chats.length === 0) {
      loadChatsAndRequests();
    }
  });

  async function loadAccountsForNetwork(network: string) {
    // Если уже идет подключение, не прерываем его
    if (statusState.isConnecting) return;

    // 1. Останавливаем старый бэкенд, если он был
    if (statusState.backendPort) {
      try {
        await stopBackend();
      } catch (e) {
        console.warn("Failed to stop old backend:", e);
      }
      // Даем время процессу умереть и освободить порт
      await new Promise(r => setTimeout(r, 500));
      statusState.isConnected = false;
      statusState.backendPort = null;
    }

    // 2. Включаем спиннер
    statusState.isConnecting = true;
    statusState.errorMsg = '';

    try {
      // 3. Запускаем новый бэкенд для выбранной сети
      const backendInfo = await startBackend(network);
      console.log("backendInfo:", backendInfo); // <-- Проверка

      statusState.backendPort = backendInfo.port;
      statusState.backendDataDir = backendInfo.dataDir;
      currentNetwork = network;

      // 4. Ждем, пока бэкенд поднимется (важно!)
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 5. Инициализируем приложение (получаем список аккаунтов)
      const initData = await initializeApplication(
        statusState.backendPort,
        statusState.backendDataDir,
        backendInfo.chainId
      );

      // 6. Обновляем состояние аккаунтов
      if (initData.accounts && initData.accounts.length > 0) {
        setAccounts(initData.accounts);
        selectedAccountKeyUid = initData.accounts[0]["key-uid"];
        hasProfiles = true;
      } else {
        setAccounts([]);
        selectedAccountKeyUid = '';
        hasProfiles = false;
      }

      // 7. Обновляем сетевую информацию
      setNetworkInfo(
        backendInfo.networkName,
        backendInfo.rpcUrl,
        backendInfo.wakuFleet,
        backendInfo.isTestnet,
        backendInfo.chainId
      );

      statusState.isConnected = true;
    } catch (e: any) {
      console.error("loadAccountsForNetwork error:", e);
      statusState.errorMsg = `Failed to load accounts: ${e?.message || e || 'Unknown error'}`;
      statusState.isConnected = false;
      statusState.backendPort = null;
    } finally {
      statusState.isConnecting = false;
    }
  }

  // При смене сети в MainEntryScreen
  async function handleNetworkChange(network: string) {
    console.log("handleNetworkChange:", network); // <-- Проверка
    await loadAccountsForNetwork(network);
  }

  // При логине (бэкенд уже запущен)
  async function handleLogin(loginPassword: string) {
    console.log("handleLogin called. Password:", loginPassword, "Port:", statusState.backendPort, "Account:", selectedAccountKeyUid);

    if (!statusState.backendPort) {
      console.error("No backend port");
      statusState.errorMsg = "Backend not connected";
      return;
    }
    if (!loginPassword) {
      console.error("No password");
      statusState.errorMsg = "Password is empty";
      return;
    }
    if (!selectedAccountKeyUid) {
      console.error("No account selected");
      statusState.errorMsg = "No account selected";
      return;
    }

    await reconnectWs(statusState.backendPort);

    try {
      console.log("Calling loginAccount...");
      const result = await loginAccount(statusState.backendPort, loginPassword, selectedAccountKeyUid);
      console.log("loginAccount result:", result);
      // Успех: processSignal установит isLoggedIn = true
    } catch (e: any) {
      console.error("Login failed:", e);
      statusState.errorMsg = `Login failed: ${e.message || e}`;
    }
  }

  async function connect(network: string) {
    if (ws || statusState.isConnected) return;

    statusState.isConnecting = true; // <-- Включаем спиннер только здесь
    statusState.errorMsg = '';

    try {
      const backendInfo = await startBackend(network); // <-- Передаем сеть
      statusState.backendPort = backendInfo.port;
      statusState.backendDataDir = backendInfo.dataDir;

      setNetworkInfo(
        backendInfo.networkName,
        backendInfo.rpcUrl,
        backendInfo.wakuFleet,
        backendInfo.isTestnet
      );

      await new Promise((resolve) => setTimeout(resolve, 1500));

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
        hasProfiles = false;
      }

      await reconnectWs(statusState.backendPort);
      statusState.isConnected = true;

    } catch (e: any) {
      statusState.errorMsg = `Connection failed: ${e.message || e}`;
      statusState.isConnected = false;
      ws = null;
    } finally {
      statusState.isConnecting = false; // <-- Выключаем спиннер
    }
  }

  async function reconnectWs(port: number) {
    if (ws) {
      try { await ws.disconnect(); } catch (e) {}
      ws = null;
    }

    ws = await WebSocket.connect(`ws://127.0.0.1:${port}/signals`);
    ws.addListener((msg) => processSignal(msg.data));
    console.log("✅ WebSocket подключен к порту", port);
  }

  // Обработчик создания аккаунта
  async function handleCreateAccount(newPassword: string) {
    console.log("handleCreateAccount called with password:", newPassword); // <-- Отладка

    if (!statusState.backendPort) {
      await connect(selectedNetwork);
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      await reconnectWs(statusState.backendPort);
    }

    if (statusState.backendPort && statusState.backendDataDir) {
      statusState.isConnecting = true;
      try {
        const createResult = await createAccountAndLogin(
          statusState.backendPort,
          statusState.backendDataDir,
          newPassword // <-- Используем аргумент
        );

        if (createResult?.error) throw new Error(createResult.error);

        let attempts = 0;
        while (!statusState.isLoggedIn && attempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
        if (statusState.isLoggedIn) hasProfiles = true;
        else statusState.errorMsg = "Account created but login signal not received.";
      } catch (e: any) {
        statusState.errorMsg = `Create account failed: ${e.message}`;
      } finally {
        statusState.isConnecting = false;
      }
    }
  }

  async function handleDisconnect() {
    // 1. Отключаем WebSocket
    if (ws) {
      try { await ws.disconnect(); } catch (e) {}
      ws = null;
    }

    // 2. Останавливаем бэкенд
    try {
      await stopBackend();
    } catch (e) {
      console.warn("Failed to stop backend:", e);
    }

    // 3. Ждем, пока процесс умрет, и сбрасываем все состояние
    await new Promise(r => setTimeout(r, 500));
    resetState(); // Это сбросит backendPort в null, accounts в [], isConnecting в false

    // 4. Явно сбрасываем локальные переменные
    hasProfiles = false;
    selectedAccountKeyUid = '';
    password = '';
    currentNetwork = 'mainnet'; // Сбрасываем сеть на дефолтную

    // 5. Запускаем бэкенд заново (как при старте приложения)
    await loadAccountsForNetwork('mainnet');
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
          alert("Recovery is not yet implemented. Please use Create Profile or Log In.");
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
        <Pane defaultSize={30} minSize={20} class="h-full overflow-hidden border-r border-border">
          {#if activeSection === 'home' || activeSection === 'profile'}
            <ProfileLeft displayName="Stauri User" onDisconnect={handleDisconnect} />
          {:else if activeSection === 'contacts'}
            <ContactsLeft />
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
            <ProfileLeft displayName="Stauri User" onDisconnect={handleDisconnect} />
          {/if}
        </Pane>

        <PaneResizer class="w-1 bg-border hover:bg-primary transition-colors cursor-col-resize" />

        <Pane defaultSize={70} class="h-full bg-card">
          {#if activeSection === 'home'}
            <HomeMain />
          {:else if activeSection === 'profile'}
            <ProfileMain />
          {:else if activeSection === 'contacts'}
            <ContactsMain />
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
              onRefresh={async () => {
              await loadChatsAndRequests();
              // После обновления списка ищем наш чат в новом списке
              if (selectedChat) {
              const updated = chats.find(c => c.id === selectedChat?.id);
              if (updated) selectedChat = updated;
              }
              }}
              />
            {:else}
              <HomeMain />
            {/if}
          </Pane>
      </PaneGroup>
    </div>
  {/if}
</div>
