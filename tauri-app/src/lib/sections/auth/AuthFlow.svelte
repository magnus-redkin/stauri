<script lang="ts">
  import { i18n } from '$lib/i18n';
  import WelcomeScreen from "./WelcomeScreen.svelte"; // <-- Относительный путь
  import SelectProfileScreen from "./SelectProfileScreen.svelte";
  import MnemonicScreen from "./MnemonicScreen.svelte";
  import CreateProfileScreen from "./CreateProfileScreen.svelte";
  import RecoveryScreen from "./RecoveryScreen.svelte";


  let { onLogin, hasProfiles }: { onLogin: () => void, hasProfiles: boolean } = $props();
  let authMode = $state<'welcome' | 'select' | 'mnemonic' | 'create' | 'recovery'>('welcome');
</script>

{#if authMode === 'welcome'}
  <WelcomeScreen {hasProfiles} onCreate={() => authMode = 'mnemonic'} onRecovery={() => authMode = 'recovery'} onSelect={() => authMode = 'select'} />
{:else if authMode === 'select'}
  <SelectProfileScreen onBack={() => authMode = 'welcome'} onLogin={onLogin} />
{:else if authMode === 'mnemonic'}
  <MnemonicScreen onBack={() => authMode = 'welcome'} onNext={() => authMode = 'create'} />
{:else if authMode === 'create'}
  <CreateProfileScreen onBack={() => authMode = 'mnemonic'} onCreate={onLogin} />
{:else if authMode === 'recovery'}
  <RecoveryScreen onBack={() => authMode = 'welcome'} onLogin={onLogin} />
{/if}
