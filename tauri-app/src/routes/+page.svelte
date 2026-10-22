<script lang="ts">
  import { onMount } from 'svelte';
  import WebSocket from '@tauri-apps/plugin-websocket';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  import {
    startBackend,
    initializeApplication,
    loginAccount,
    createAccountAndLogin,
    stopBackend,
  } from '$lib/status/api';

  import {
    statusState,
    processSignal,
    resetState,
    setAccounts,
    logout
  } from '$lib/stores/statusStore.svelte';

  import { PaneGroup, Pane, PaneResizer } from "paneforge";
  import SidebarIcons from "$lib/sections/layout/SidebarIcons.svelte";
  import ComingSoon from "$lib/sections/layout/ComingSoon.svelte";

  import HomeLeft from "$lib/sections/home/HomeLeft.svelte";
  import HomeMain from "$lib/sections/home/HomeMain.svelte";
  import ProfileLeft from "$lib/sections/profile/ProfileLeft.svelte";
  import ProfileMain from "$lib/sections/profile/ProfileMain.svelte";
  import ContactsLeft from "$lib/sections/contacts/ContactsLeft.svelte";
  import ContactsMain from "$lib/sections/contacts/ContactsMain.svelte";
  import SettingsLeft from "$lib/sections/settings/SettingsLeft.svelte";
  import SettingsMain from "$lib/sections/settings/SettingsMain.svelte";
  import WalletLeft from "$lib/sections/wallet/WalletLeft.svelte";
  import WalletMain from "$lib/sections/wallet/WalletMain.svelte";
  import MarketMain from "$lib/sections/market/MarketMain.svelte";

  let activeSection = $state('home');
  let ws: WebSocket | null = null;
  let selectedAccountKeyUid = $state('');
  let hasProfiles = $state(false);
  let password = $state('');
  let passwordInput: HTMLInputElement | undefined = $state();

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

  // Автофокус при показе формы логина
  $effect(() => {
    if (statusState.isConnected && !statusState.isLoggedIn && passwordInput) {
      setTimeout(() => passwordInput?.focus(), 50);
    }
  });

  onMount(() => {
    connect();
  });

  async function reconnectWs(port: number) {
    if (ws) {
      try { await ws.disconnect(); } catch (e) {}
      ws = null;
    }
    ws = await WebSocket.connect(`ws://127.0.0.1:${port}/signals`);
    ws.addListener((msg) => processSignal(msg.data));
  }

  async function connect() {
    if (ws || statusState.isConnected) return;

    statusState.isConnecting = true; // <-- Включаем спиннер
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

  async function handleLogin() {
    if (!statusState.backendPort || !password || !selectedAccountKeyUid) return;

    try {
      await loginAccount(statusState.backendPort, password, selectedAccountKeyUid);
      password = '';
    } catch (e: any) {
      statusState.errorMsg = `Login failed: ${e.message || e}`;
    }
  }

  async function handleCreateAccount(newPassword: string) {
    if (!statusState.backendPort || !statusState.backendDataDir) return;

    try {
      await createAccountAndLogin(statusState.backendPort, statusState.backendDataDir, newPassword);
      await stopBackend();
      const newBackendInfo = await startBackend();
      statusState.backendPort = newBackendInfo.port;
      statusState.backendDataDir = newBackendInfo.dataDir;
      await new Promise(r => setTimeout(r, 1500));
      await reconnectWs(statusState.backendPort);

      const initData = await initializeApplication(statusState.backendPort, statusState.backendDataDir);
      if (initData.accounts) {
        setAccounts(initData.accounts);
        selectedAccountKeyUid = initData.accounts[0]["key-uid"];
        hasProfiles = true;
      }
    } catch (e: any) {
      statusState.errorMsg = `Create account failed: ${e.message || e}`;
    }
  }

  async function handleLogout() {
    await logout();
  }

  async function handleDisconnect() {
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

<!-- СПИННЕР -->
{#if statusState.isConnecting}
  <div class="h-screen w-screen bg-background flex flex-col items-center justify-center gap-4">
    <div class="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    <p class="text-muted-foreground">Connecting to Status backend...</p>
  </div>

<!-- ОШИБКА ПОДКЛЮЧЕНИЯ -->
{:else if statusState.errorMsg && !statusState.isConnected}
  <div class="h-screen w-screen bg-background flex flex-col items-center justify-center gap-4 p-6">
    <div class="text-red-500 text-xl font-bold">Connection Error</div>
    <p class="text-muted-foreground text-center max-w-md">{statusState.errorMsg}</p>
    <button onclick={connect} class="px-6 py-2 bg-primary text-primary-foreground rounded-lg mt-4">Retry</button>
  </div>

<!-- ЭКРАН ЛОГИНА (если подключен, но не залогинен) -->
{:else if !statusState.isLoggedIn}
  <div class="h-screen w-screen flex bg-background">
    <!-- Левая панель с инфо о коннекте -->
    <div class="w-1/3 border-r border-border h-full">
       <ProfileLeft displayName="Tauri User" onDisconnect={handleDisconnect} />
    </div>

    <!-- Правая панель с логином -->
    <div class="flex-1 flex items-center justify-center p-6">
      <div class="max-w-md w-full space-y-4">
        <h2 class="text-2xl font-bold text-primary">Welcome to Stauri</h2>

        {#if hasProfiles}
          <div class="space-y-3">
            <select bind:value={selectedAccountKeyUid} class="w-full h-10 border border-border rounded-md px-3 bg-background">
              {#each statusState.accounts as acc, i (acc["key-uid"])}
                <option value={acc["key-uid"]}>Acc {acc["key-uid"].substring(0, 8)}...</option>
              {/each}
            </select>
            <input
              bind:this={passwordInput}
              type="password"
              bind:value={password}
              placeholder="Password"
              class="w-full h-10 border border-border rounded-md px-3"
              onkeydown={(e) => { if (e.key === 'Enter') handleLogin(); }}
            />
            <button onclick={handleLogin} class="w-full h-10 bg-primary text-primary-foreground rounded-md">Login</button>
          </div>
        {:else}
          <input type="password" placeholder="New Password" class="w-full h-10 border border-border rounded-md px-3" id="newpass" />
          <button onclick={() => {
            const p = (document.getElementById('newpass') as HTMLInputElement).value;
            if(p) handleCreateAccount(p);
          }} class="w-full h-10 bg-primary text-primary-foreground rounded-md">Create Profile</button>
        {/if}
      </div>
    </div>
  </div>

<!-- ОСНОВНОЙ ИНТЕРФЕЙС (если залогинен) -->
{:else}
  <div class="h-screen w-screen flex bg-background text-foreground overflow-hidden font-sans">
    <SidebarIcons bind:activeSection />

    <div class="flex-1 h-full overflow-hidden">
      <PaneGroup direction="horizontal" class="h-full">
        <!-- LEFT -->
        <Pane defaultSize={30} minSize={20} class="h-full">
          {#if activeSection === 'home'}
            <HomeLeft />
          {:else if activeSection === 'profile'}
            <ProfileLeft displayName="Tauri User" onDisconnect={handleDisconnect} />
          {:else if activeSection === 'contacts'}
            <ContactsLeft />
          {:else if activeSection === 'settings'}
            <SettingsLeft />
          {:else if activeSection === 'wallet'}
            <WalletLeft onNavigate={(s) => activeSection = s} />
          {:else if activeSection === 'market'}
            <div class="p-4 border-r border-border bg-card h-full">
              <div class="font-bold text-lg text-primary">Market</div>
            </div>
          {:else}
            <ProfileLeft displayName="Tauri User" onDisconnect={handleDisconnect} />
          {/if}
        </Pane>

        <PaneResizer class="w-1 bg-border hover:bg-primary transition-colors cursor-col-resize" />

        <!-- MAIN -->
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
          {:else}
            <ComingSoon />
          {/if}
        </Pane>
      </PaneGroup>
    </div>
  </div>
{/if}
