<script lang="ts">
  import { i18n } from '$lib/i18n';
  import NetworkPicker from './NetworkPicker.svelte';
  import ProfileLoginBlock from './ProfileLoginBlock.svelte';
  import CreateProfileBlock from './CreateProfileBlock.svelte';
  import { statusState } from '$lib/stores/statusStore.svelte';

  let {
    onLogin,
    onCreate,
    onRecovery,
    onNetworkChange,
    hasProfiles = false,
    selectedAccountKeyUid = $bindable(''),
    selectedNetwork = $bindable('mainnet')
  }: {
    onLogin: (password: string) => void; // <-- Теперь пароль передается в колбэк
    onCreate: (password: string) => void; // <-- Теперь пароль передается в колбэк
    onRecovery: () => void;
    onNetworkChange?: (network: string) => void;
    hasProfiles: boolean;
    selectedAccountKeyUid: string;
    selectedNetwork: string;
  } = $props();

  // Раздельные состояния для паролей
  let loginPassword = $state('');
  let createPassword = $state('');

  let showCreate = $state(false);
</script>

<div class="flex flex-col items-center justify-center min-h-screen gap-6 p-4 bg-background">
  <h1 class="text-3xl font-bold text-foreground">Stauri</h1>

  <NetworkPicker
    bind:selectedNetwork
    onSelect={(net) => onNetworkChange?.(net)}
  />

  <div class="w-full max-w-md h-px bg-border my-2"></div>

  {#if hasProfiles}
    <ProfileLoginBlock
      bind:selectedAccountKeyUid
      bind:password={loginPassword}
      onLogin={() => onLogin(loginPassword)}
    />

    {#if !showCreate}
      <button
        onclick={() => showCreate = true}
        class="w-full max-w-md py-2 border border-border rounded-md text-sm font-medium hover:bg-secondary transition"
      >
        + {i18n.t('Create new profile')}
      </button>
    {/if}
  {/if}

  {#if !hasProfiles || showCreate}
    <CreateProfileBlock
      bind:password={createPassword}
      onCreate={() => onCreate(createPassword)}
    />
  {/if}

  <div class="w-full max-w-md flex flex-col gap-2 mt-2">
    <button
      onclick={onRecovery}
      class="w-full py-2 border border-border rounded-md text-sm font-medium hover:bg-secondary transition"
    >
      {i18n.t('Log in by recovery phrase')}
    </button>

    <button
      disabled
      class="w-full py-2 border border-border rounded-md text-sm font-medium opacity-50 cursor-not-allowed"
    >
      {i18n.t('Log in by sync')} (Coming Soon)
    </button>

    <button
      disabled
      class="w-full py-2 border border-border rounded-md text-sm font-medium opacity-50 cursor-not-allowed"
    >
      {i18n.t('Log in with Keycard')} (Coming Soon)
    </button>
  </div>

  {#if statusState.errorMsg}
    <p class="text-destructive text-sm text-center max-w-md">{statusState.errorMsg}</p>
  {/if}
</div>
