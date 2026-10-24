<script lang="ts">
  import { i18n } from '$lib/i18n';
  import PasswordInput from '$lib/sections/auth/PasswordInput.svelte';

  let {
    password = $bindable(''),
    onCreate
  }: {
    password: string;
    onCreate: () => void;
  } = $props();
</script>

<div class="w-full max-w-md space-y-3 p-4 border border-border rounded-lg bg-card">
  <h3 class="font-semibold text-foreground text-sm">{i18n.t('Create new profile')}</h3>

  <PasswordInput
    bind:value={password}
    placeholder={i18n.t('New Password')}
    onEnter={onCreate}
    autofocus={true}
  />

  <button
    onclick={onCreate}
    class="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition"
  >
    {i18n.t('Create Profile')}
  </button>
</div>
