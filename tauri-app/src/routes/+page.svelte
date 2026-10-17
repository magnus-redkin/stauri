<script lang="ts">
  import WebSocket from '@tauri-apps/plugin-websocket';
  import { onMount } from 'svelte';
  import { invoke } from "@tauri-apps/api/core";

  // --- WebSocket логика ---
  let ws: WebSocket | null = $state(null);
  let messages = $state<string[]>([]);
  let isConnected = $state(false);
  let errorMsg = $state('');

  async function connect() {
    if (ws) return; // Защита от повторных подключений

    try {
      errorMsg = '';
      ws = await WebSocket.connect('ws://localhost:12345/signals');
      isConnected = true;
      ws.addListener((msg) => {
        messages = [...messages, msg.data];
      });
    } catch (e) {
      errorMsg = `Connection failed: ${e}`;
      isConnected = false;
      ws = null;
    }
  }

  async function disconnect() {
    if (ws) {
      await ws.disconnect();
      ws = null;
      isConnected = false;
    }
  }

  // --- Greet логика ---
  let name = $state("");
  let greetMsg = $state("");

  async function greet(event: Event) {
    event.preventDefault();
    greetMsg = await invoke("greet", { name });
  }
</script>

<!-- Фон и центрирование -->
<div class="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6 font-sans transition-colors">
  <main class="max-w-2xl mx-auto flex flex-col items-center gap-6">

    <h1 class="text-3xl font-bold text-center">Tauri + Svelte + Tailwind</h1>

    <!-- Блок с логотипами -->
    <div class="flex justify-center gap-4">
      <a href="https://vite.dev" target="_blank" class="transition-transform hover:scale-110">
        <img src="/vite.svg" class="h-16 w-16" alt="Vite Logo" />
      </a>
      <a href="https://tauri.app" target="_blank" class="transition-transform hover:scale-110">
        <img src="/tauri.svg" class="h-16 w-16" alt="Tauri Logo" />
      </a>
      <a href="https://svelte.dev" target="_blank" class="transition-transform hover:scale-110">
        <img src="/svelte.svg" class="h-16 w-16" alt="Svelte Logo" />
      </a>
    </div>

    <!-- Форма Greet -->
    <form onsubmit={greet} class="flex gap-2 w-full max-w-md">
      <input
        id="greet-input"
        placeholder="Enter a name..."
        bind:value={name}
        class="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
      />
      <button
        type="submit"
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors"
      >
        Greet
      </button>
    </form>
    {#if greetMsg}
      <p class="text-lg font-semibold text-green-600 dark:text-green-400">{greetMsg}</p>
    {/if}

    <!-- Разделитель -->
    <hr class="w-full border-gray-300 dark:border-gray-700 my-4" />

    <!-- Секция WebSocket -->
    <h2 class="text-2xl font-semibold">Status Backend WebSocket</h2>

    {#if errorMsg}
      <div class="w-full p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg border border-red-300 dark:border-red-800">
        {errorMsg}
      </div>
    {/if}

    <div class="flex items-center gap-4">
      {#if !isConnected}
        <button
          onclick={connect}
          class="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow transition-colors"
        >
          Connect to Status WS
        </button>
      {:else}
        <button
          onclick={disconnect}
          class="px-6 py-2 bg-red-500 hover:bg-red-600 text-white font-medium rounded-lg shadow transition-colors"
        >
          Disconnect
        </button>
        <span class="flex items-center gap-1.5 text-green-600 dark:text-green-400 font-semibold">
          <span class="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></span>
          Connected
        </span>
      {/if}
    </div>

    <!-- Список сообщений -->
    {#if messages.length > 0}
      <div class="w-full bg-gray-900 text-green-400 rounded-lg p-4 shadow-inner max-h-80 overflow-y-auto font-mono text-sm">
        <div class="flex justify-between items-center mb-2 pb-2 border-b border-gray-700">
          <h3 class="text-white font-bold">Messages</h3>
          <span class="text-gray-400 text-xs">{messages.length} total</span>
        </div>
        <ul class="space-y-1">
          {#each messages as msg, i}
            <li class="break-all leading-relaxed">{msg}</li>
          {/each}
        </ul>
      </div>
    {/if}

  </main>
</div>
