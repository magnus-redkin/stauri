<script lang="ts">
  import WebSocket from '@tauri-apps/plugin-websocket';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { register } from '@tauri-apps/plugin-global-shortcut';
  import {
    startBackend,
    initializeApplication,
    createAccountAndLogin,
    loginAccount,
    startMessenger
  } from '$lib/status/api';

  import ChatView from '$lib/modules/chat/ChatView.svelte';
  import WalletView from '$lib/modules/wallet/WalletView.svelte';
  import DappBrowserView from '$lib/modules/dapps/DappBrowserView.svelte';

  // --- Состояния подключения ---
  let ws: WebSocket | null = null;
  let messages = $state<string[]>([]);
  let isConnected = $state(false);
  let isConnecting = $state(false);
  let errorMsg = $state('');

  let backendPort = $state<number | null>(null);
  let backendDataDir = $state<string>('');

  // --- Состояния аккаунта ---
  let accountExists = $state(false);
  let isLoggedIn = $state(false);
  let password = $state('');
  let isProcessing = $state(false);
  let accountKeyUid = $state('');

  // --- Вкладки ---
    let activeTab = $state<'chat' | 'wallet' | 'dapps'>('chat');

  // --- Регистрация Ctrl+Q ---
  $effect(() => {
    let isRegistered = false;

    register('CommandOrControl+Q', (event) => {
      if (event.state === 'Pressed') {
        getCurrentWindow().close();
      }
    }).then(() => {
      isRegistered = true;
      console.log('Shortcut registration succeeded');
    }).catch((e) => {
      console.error('Shortcut registration failed:', e);
    });

    return () => {
      // При уничтожении компонента можно снять регистрацию,
      // но в Tauri она снимается автоматически при закрытии окна.
      isRegistered = false;
    };
  });

  async function connect() {
    if (ws || isConnected || isConnecting) return;
    isConnecting = true;
    errorMsg = '';

    try {
      // 1. Запускаем бэкенд
      const backendInfo = await startBackend();
      backendPort = backendInfo.port;
      backendDataDir = backendInfo.dataDir;

      console.log(`Backend started on port ${backendPort}, dataDir: ${backendDataDir}`);

      // 2. Ждем инициализации
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // 3. HTTP вызов InitializeApplication
      const initData = await initializeApplication(backendPort, backendDataDir);
      console.log("InitializeApplication response:", initData);

      if (initData.accounts && initData.accounts.length > 0) {
        accountExists = true;
        const acc = initData.accounts[0];
        accountKeyUid = acc["key-uid"] || acc.keyUid || acc.KeyUID || '';
        console.log("Found account key-uid:", accountKeyUid);
      }

      // 4. Подключаем WebSocket
      ws = await WebSocket.connect(`ws://127.0.0.1:${backendPort}/signals`);
      isConnected = true;

      ws.addListener((msg) => {
        messages = [...messages, msg.data];

        // Парсим события, чтобы отслеживать логин и запускать мессенджер
        try {
          const parsed = JSON.parse(msg.data);

          if (parsed.type === 'node.login') {
            if (parsed.event?.error) {
              console.error("Login error from signal:", parsed.event.error);
              errorMsg = `Login failed: ${parsed.event.error}`;
              return;
            }

            // Логин успешен
            accountKeyUid = parsed.event?.settings?.['key-uid'] || accountKeyUid;
            isLoggedIn = true;

            // Запускаем мессенджер теперь, когда бэкенд готов
            if (backendPort) {
              startMessenger(backendPort)
                .then(() => console.log("Messenger started successfully"))
                .catch((e) => console.warn("Messenger start warning:", e));
            }
          }
        } catch (e) {
          // Игнорируем не-JSON сообщения
        }
      });

    } catch (e: any) {
      console.error(e);
      errorMsg = `Connection failed: ${e.message || e}`;
      isConnected = false;
      ws = null;
    } finally {
      isConnecting = false;
    }
  }

  async function login() {
    if (!backendPort || !password || !accountKeyUid) return;
    isProcessing = true;
    errorMsg = '';

    try {
      console.log("LoginAccount request:", { keyUid: accountKeyUid });
      await loginAccount(backendPort, password, accountKeyUid);
      // Не вызываем startMessenger здесь — он запустится по сигналу node.login
      password = '';
    } catch (e: any) {
      errorMsg = `Login failed: ${e.message || e}`;
    } finally {
      isProcessing = false;
    }
  }

  async function createAccount() {
    if (!backendPort || !backendDataDir || !password) return;
    isProcessing = true;
    errorMsg = '';

    try {
      await createAccountAndLogin(backendPort, backendDataDir, password);
      // Мессенджер тоже запустится по сигналу node.login
      accountExists = true;
      password = '';
    } catch (e: any) {
      errorMsg = `Create account failed: ${e.message || e}`;
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
    isConnected = false;
    isLoggedIn = false;
    accountExists = false;
  }
</script>

<div class="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 font-sans">
  <main class="max-w-3xl mx-auto flex flex-col items-center gap-6">
    <h1 class="text-3xl font-bold mt-4">Status Tauri App</h1>

    {#if errorMsg}
      <div class="w-full p-3 bg-red-100 text-red-700 rounded-lg border border-red-300">{errorMsg}</div>
    {/if}

    <!-- Кнопки подключения -->
    <div class="flex items-center gap-4">
      {#if !isConnected}
        <button onclick={connect} disabled={isConnecting} class="px-6 py-2 bg-green-600 text-white rounded-lg disabled:bg-gray-400">
          {isConnecting ? 'Connecting...' : 'Connect'}
        </button>
      {:else}
        <button onclick={disconnect} class="px-6 py-2 bg-red-500 text-white rounded-lg">Disconnect</button>
        <span class="text-green-600 font-semibold">● Connected (Port: {backendPort})</span>
      {/if}
    </div>

    <!-- Блок авторизации / создания аккаунта -->
    {#if isConnected && !isLoggedIn}
      <div class="w-full bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200">
        <h3 class="font-bold mb-2">
          {accountExists ? 'Welcome back! Enter your password:' : 'No accounts found. Create one?'}
        </h3>
        <div class="flex gap-2">
          <input
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
    {#if isLoggedIn}
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
        <ChatView {messages} />
      {:else if activeTab === 'wallet'}
        {#if backendPort}
          <WalletView port={backendPort} />
        {/if}
      {:else if activeTab === 'dapps'}
        <DappBrowserView />
      {/if}

    {:else if messages.length > 0}
      <!-- Сырые сигналы до логина (для отладки) -->
      <div class="w-full bg-gray-900 text-green-400 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm">
        <h3 class="text-white font-bold mb-2">Initial Signals ({messages.length})</h3>
        <ul class="space-y-1">
          {#each messages as msg}
            <li class="break-all border-b border-gray-800 pb-1">{msg}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </main>
</div>
