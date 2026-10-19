<script lang="ts">
  import WebSocket from '@tauri-apps/plugin-websocket';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import {
    startBackend,
    initializeApplication,
    createAccountAndLogin,
    loginAccount,
    stopBackend,
    getAccountsList
  } from '$lib/status/api';
  import {
    statusState,
    processSignal,
    resetState,
    setAccounts,
    logout
  } from '$lib/stores/statusStore.svelte';
  import ChatView from '$lib/modules/chat/ChatView.svelte';
  import WalletView from '$lib/modules/wallet/WalletView.svelte';
  import DappBrowserView from '$lib/modules/dapps/DappBrowserView.svelte';

  let ws: WebSocket | null = null;
  let isConnecting = $state(false);
  let password = $state('');
  let isProcessing = $state(false);
  let activeTab = $state<'chat' | 'wallet' | 'dapps'>('chat');

  // Для создания нового аккаунта
  let newPassword = $state('');
  let showCreateForm = $state(false);

  // Выбранный аккаунт (по умолчанию первый)
  let selectedAccountKeyUid = $state('');

  // Автофокус на поле пароля
  let passwordInput: HTMLInputElement | undefined = $state();

  // Наличие аккаунта
  const accountExists = $derived(statusState.accounts.length > 0);

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

  // Автофокус при подключении
  $effect(() => {
    if (statusState.isConnected && !statusState.isLoggedIn && passwordInput) {
      setTimeout(() => passwordInput?.focus(), 50);
    }
  });

  // --- Вспомогательная функция для переподключения WebSocket ---
  async function reconnectWs(port: number) {
    if (ws) {
      try { await ws.disconnect(); } catch (e) {}
      ws = null;
    }
    ws = await WebSocket.connect(`ws://127.0.0.1:${port}/signals`);
    ws.addListener((msg) => processSignal(msg.data));
  }

  async function connect() {
    if (ws || statusState.isConnected || isConnecting) return;
    isConnecting = true;
    statusState.errorMsg = '';

    try {
      const backendInfo = await startBackend();
      statusState.backendPort = backendInfo.port;
      statusState.backendDataDir = backendInfo.dataDir;

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const initData = await initializeApplication(statusState.backendPort, statusState.backendDataDir);

      if (initData.accounts && initData.accounts.length > 0) {
        setAccounts(initData.accounts);
        selectedAccountKeyUid = initData.accounts[0]["key-uid"];
      }

      await reconnectWs(statusState.backendPort);
      statusState.isConnected = true;

    } catch (e: any) {
      statusState.errorMsg = `Connection failed: ${e.message || e}`;
      statusState.isConnected = false;
      ws = null;
    } finally {
      isConnecting = false;
    }
  }

  async function login() {
    if (!statusState.backendPort || !password || !selectedAccountKeyUid) return;

    isProcessing = true;
    statusState.errorMsg = '';

    try {
      await loginAccount(statusState.backendPort, password, selectedAccountKeyUid);
      password = '';
    } catch (e: any) {
      statusState.errorMsg = `Login failed: ${e.message || e}`;
    } finally {
      isProcessing = false;
    }
  }

  async function createAccount() {
    if (!statusState.backendPort || !statusState.backendDataDir || !password) return;
    isProcessing = true;
    statusState.errorMsg = '';

    try {
      await createAccountAndLogin(statusState.backendPort, statusState.backendDataDir, password);
      password = '';
    } catch (e: any) {
      statusState.errorMsg = `Create account failed: ${e.message || e}`;
    } finally {
      isProcessing = false;
    }
  }

  async function createNewAccount() {
    if (!statusState.backendPort || !statusState.backendDataDir || !newPassword) return;

    isProcessing = true;
    statusState.errorMsg = '';

    try {
      // 1. Выходим из текущего аккаунта
      if (statusState.isLoggedIn) {
        await logout();
      }

      // 2. Создаем новый аккаунт
      await createAccountAndLogin(statusState.backendPort, statusState.backendDataDir, newPassword);

      // 3. Перезапускаем sidecar, чтобы InitializeApplication увидел новый список
      await stopBackend();

      const newBackendInfo = await startBackend();
      statusState.backendPort = newBackendInfo.port;
      statusState.backendDataDir = newBackendInfo.dataDir;

      await new Promise(r => setTimeout(r, 1500));

      // 4. Переподключаем WebSocket к новому порту
      await reconnectWs(statusState.backendPort);

      // 5. Заново получаем список аккаунтов
      const initData = await initializeApplication(statusState.backendPort, statusState.backendDataDir);
      if (initData.accounts) {
        setAccounts(initData.accounts);
        selectedAccountKeyUid = initData.accounts[0]["key-uid"];
      }

      newPassword = '';
      showCreateForm = false;
    } catch (e: any) {
      statusState.errorMsg = `Create account failed: ${e.message || e}`;
    } finally {
      isProcessing = false;
    }
  }

  async function handleLogout() {
    await logout();
  }

  async function disconnect() {
    if (ws) {
      try { await ws.disconnect(); } catch (e) {}
      ws = null;
    }
    try {
      await stopBackend();
    } catch (e) {
      console.warn("Failed to stop backend:", e);
    }
    resetState();
  }
</script>

<div class="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 font-sans">
  <main class="max-w-3xl mx-auto flex flex-col items-center gap-6">
    <h1 class="text-3xl font-bold mt-4">Stauri</h1>

    {#if statusState.errorMsg}
      <div class="w-full p-3 bg-red-100 text-red-700 rounded-lg border border-red-300">{statusState.errorMsg}</div>
    {/if}

<!-- Кнопки подключения -->
      <div class="flex items-center gap-4">
        {#if !statusState.isConnected}
          <button onclick={connect} disabled={isConnecting} class="px-6 py-2 bg-green-600 text-white rounded-lg disabled:bg-gray-400">
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        {:else}
          <button onclick={disconnect} class="px-6 py-2 bg-red-500 text-white rounded-lg">Disconnect</button>
          <span class="text-green-600 font-semibold">
            ● Connected (Port: {statusState.backendPort})
            {#if statusState.isLoggedIn && statusState.accountKeyUid}
              — Acc {statusState.accountKeyUid.substring(0, 8)}...
            {/if}
          </span>
        {/if}
      </div>

    <!-- Блок авторизации -->
    {#if statusState.isConnected && !statusState.isLoggedIn}
      <div class="w-full bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200">
        {#if !showCreateForm}
          <h3 class="font-bold mb-2">
            {accountExists ? 'Welcome back! Enter your password:' : 'No accounts found. Create one?'}
          </h3>

          <!-- Селектор аккаунта (если их больше одного) -->
          {#if statusState.accounts.length > 1}
            <div class="mb-3">
              <label class="text-sm font-semibold">Select account:</label>
              <select bind:value={selectedAccountKeyUid} class="w-full p-2 border rounded-lg mt-1 dark:bg-gray-800 dark:border-gray-700">
                {#each statusState.accounts as acc, i (acc["key-uid"])}
                  <option value={acc["key-uid"]}>
                      Acc {acc["key-uid"].substring(0, 8)}...
                  </option>
                {/each}
              </select>
            </div>
          {/if}

          <div class="flex gap-2">
            <input
              bind:this={passwordInput}
              type="password"
              bind:value={password}
              placeholder="Password"
              class="flex-1 px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              onkeydown={(e) => {
                if (e.key === 'Enter' && password) {
                  accountExists ? login() : createAccount();
                }
              }}
            />
            {#if accountExists}
              <button onclick={login} disabled={isProcessing || !password} class="px-4 py-2 bg-green-600 text-white rounded-lg disabled:bg-gray-400">
                {isProcessing ? 'Logging in...' : 'Login'}
              </button>
            {:else}
              <button onclick={createAccount} disabled={isProcessing || !password} class="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:bg-gray-400">
                {isProcessing ? 'Creating...' : 'Create Account'}
              </button>
            {/if}
          </div>

          {#if accountExists}
            <div class="mt-3 text-sm">
              <button onclick={() => showCreateForm = true} class="text-blue-600 hover:underline">
                + Create a new account
              </button>
            </div>
          {/if}
        {:else}
          <!-- Форма создания нового аккаунта -->
          <h3 class="font-bold mb-2">Create a new account</h3>
          <div class="flex gap-2">
            <input
              type="password"
              bind:value={newPassword}
              placeholder="New Password"
              class="flex-1 px-3 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
              onkeydown={(e) => {
                if (e.key === 'Enter' && newPassword) {
                  createNewAccount();
                }
              }}
            />
            <button onclick={createNewAccount} disabled={isProcessing || !newPassword} class="px-4 py-2 bg-purple-600 text-white rounded-lg disabled:bg-gray-400">
              {isProcessing ? 'Creating...' : 'Create'}
            </button>
            <button onclick={() => { showCreateForm = false; newPassword = ''; }} class="px-4 py-2 bg-gray-400 text-white rounded-lg">
              Cancel
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Основной интерфейс после входа -->
    {#if statusState.isLoggedIn}
      <div class="w-full bg-green-100 text-green-800 p-3 rounded-lg flex justify-between items-center">
        <span>Logged in successfully!</span>
        <button onclick={handleLogout} class="px-4 py-1 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600">
          Logout
        </button>
      </div>

      <!-- Вкладки -->
      <div class="flex w-full border-b dark:border-gray-700 mb-4">
        <button
          class="px-6 py-2 font-semibold {activeTab === 'chat' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}"
          onclick={() => activeTab = 'chat'}
        >
          Chat
        </button>
        <button
          class="px-6 py-2 font-semibold {activeTab === 'wallet' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}"
          onclick={() => activeTab = 'wallet'}
        >
          Wallet
        </button>
        <button
          class="px-6 py-2 font-semibold {activeTab === 'dapps' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500'}"
          onclick={() => activeTab = 'dapps'}
        >
          dApps
        </button>
      </div>

      <!-- Содержимое вкладок -->
      {#if activeTab === 'chat'}
        <ChatView events={statusState.events} />
      {:else if activeTab === 'wallet'}
        {#if statusState.backendPort}
          <WalletView port={statusState.backendPort} />
        {/if}
      {:else if activeTab === 'dapps'}
        <DappBrowserView />
      {/if}

    {:else if statusState.events.length > 0}
      <!-- Сырые сигналы до логина -->
      <div class="w-full bg-gray-900 text-green-400 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm">
        <h3 class="text-white font-bold mb-2">Initial Signals ({statusState.events.length})</h3>
        <ul class="space-y-1">
          {#each statusState.events as event, i (i)}
            <li class="break-all border-b border-gray-800 pb-1">{event.type}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </main>
</div>
