<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";

  let url = $state('https://example.com');
  let errorMsg = $state('');

  async function openDapp() {
    errorMsg = '';
    try {
      await invoke('open_dapp_window', { url });
    } catch (e: any) {
      errorMsg = `Failed to open dApp: ${e}`;
    }
  }
</script>

<div class="w-full bg-white dark:bg-gray-800 rounded-lg shadow p-6">
  <h2 class="text-xl font-bold mb-4">dApp Browser</h2>

  {#if errorMsg}
    <div class="p-3 mb-4 bg-red-100 text-red-700 rounded-lg text-sm">{errorMsg}</div>
  {/if}

  <div class="flex gap-2">
    <input
      type="text"
      bind:value={url}
      placeholder="https://..."
      class="flex-1 px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
    />
    <button
      onclick={openDapp}
      class="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
    >
      Open dApp
    </button>
  </div>
  <p class="text-xs text-gray-500 mt-2">
    Opens in a new window. (Injection of window.ethereum will be added later).
  </p>
</div>
