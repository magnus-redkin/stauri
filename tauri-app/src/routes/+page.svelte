<script lang="ts">
  import { tick } from 'svelte';
  import WebSocket from '@tauri-apps/plugin-websocket';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import {
    startBackend,
    initializeApplication,
    createAccountAndLogin,
    loginAccount,
    startMessenger
  } from '$lib/status/api';
  import { statusState, processSignal, resetState } from '$lib/stores/statusStore.svelte';
  import ChatView from '$lib/modules/chat/ChatView.svelte';
  import WalletView from '$lib/modules/wallet/WalletView.svelte';
  import DappBrowserView from '$lib/modules/dapps/DappBrowserView.svelte';

  let ws: WebSocket | null = null;
  let isConnecting = $state(false);
  let password = $state('');
  let isProcessing = $state(false);
  let accountExists = $state(false);
  let activeTab = $state<'chat' | 'wallet' | 'dapps'>('chat');
  let passwordInput: HTMLInputElement | undefined = $state();

  // Ставим фокус на поле пароля, когда подключение установлено

  $effect(() => {
    if (statusState.isConnected) {
      tick().then(() => passwordInput?.focus());
    }
  });

  // --- Регистрация Ctrl+Q ---
  $effect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Работает на Windows (Ctrl), macOS (Cmd) и Linux (Ctrl)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        getCurrentWindow().close();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });


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
        accountExists = true;
        const acc = initData.accounts[0];
        statusState.accountKeyUid = acc["key-uid"] || acc.keyUid || acc.KeyUID || '';
      }

      ws = await WebSocket.connect(`ws://127.0.0.1:${statusState.backendPort}/signals`);
      statusState.isConnected = true;

      ws.addListener((msg) => {
        processSignal(msg.data);
      });

    } catch (e: any) {
      statusState.errorMsg = `Connection failed: ${e.message || e}`;
      statusState.isConnected = false;
      ws = null;
    } finally {
      isConnecting = false;
    }
  }

  async function login() {
    if (!statusState.backendPort || !password || !statusState.accountKeyUid) return;
    isProcessing = true;
    statusState.errorMsg = '';

    try {
      await loginAccount(statusState.backendPort, password, statusState.accountKeyUid);
      password = '';
      // startMessenger вызовется автоматически по сигналу node.login в statusStore
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
      accountExists = true;
      password = '';
    } catch (e: any) {
      statusState.errorMsg = `Create account failed: ${e.message || e}`;
    } finally {
      isProcessing = false;
    }
  }

  async function disconnect() {
    if (ws) {
      try {
        await ws.disconnect();
      } catch (e) {
        console.warn("WS already closed:", e);
      }
      ws = null;
    }
    resetState();
    accountExists = false;
  }
</script>

<div class="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 font-sans">
  <main class="max-w-3xl mx-auto flex flex-col items-center gap-6">
    <h1 class="text-3xl font-bold mt-4">Status Tauri App</h1>

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
        <span class="text-green-600 font-semibold">● Connected (Port: {statusState.backendPort})</span>
      {/if}
    </div>

    <!-- Блок авторизации / создания аккаунта -->
    {#if statusState.isConnected && !statusState.isLoggedIn}
      <div class="w-full bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200">
        <h3 class="font-bold mb-2">
          {accountExists ? 'Welcome back! Enter your password:' : 'No accounts found. Create one?'}
        </h3>
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
      </div>
    {/if}

    <!-- Основной интерфейс после входа -->
    {#if statusState.isLoggedIn}
      <div class="w-full bg-green-100 text-green-800 p-3 rounded-lg">
        Logged in successfully!
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
