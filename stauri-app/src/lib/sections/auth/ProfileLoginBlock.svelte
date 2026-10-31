<script lang="ts">
  import { i18n } from '$lib/i18n';
  import PasswordInput from './PasswordInput.svelte';
  import { statusState } from '$lib/stores/statusStore.svelte';

  let {
    selectedAccountKeyUid = $bindable(''),
    password = $bindable(''),
    onLogin
  }: {
    selectedAccountKeyUid: string;
    password: string;
    onLogin: () => void;
  } = $props();
</script>

<div class="w-full max-w-md space-y-3 p-4 border border-border rounded-lg bg-card">
  <select
    bind:value={selectedAccountKeyUid}
    class="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
  >
    {#each statusState.accounts as account (account["key-uid"])}
      <option value={account["key-uid"]}>{account["key-uid"].slice(0, 16)}...</option>
    {/each}
  </select>

  <PasswordInput
    bind:value={password}
    placeholder={i18n.t('Password')}
    onEnter={onLogin}
    autofocus={true}
  />

  <button
    onclick={() => {
    onLogin();
    }}
    class="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition"
    >
    {i18n.t('Log In')}
  </button>
</div>
