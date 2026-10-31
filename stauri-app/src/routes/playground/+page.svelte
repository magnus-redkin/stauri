<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { i18n, loadTranslations } from '$lib/i18n';

  import { PaneGroup, Pane, PaneResizer } from "paneforge";
  import SidebarIcons from "$lib/sections/layout/SidebarIcons.svelte";
  import MainEntryScreen from "$lib/sections/auth/MainEntryScreen.svelte";
  import ComingSoon from "$lib/sections/layout/ComingSoon.svelte";

  // Разделы
  import HomeLeft from "$lib/sections/home/HomeLeft.svelte";
  import HomeMain from "$lib/sections/home/HomeMain.svelte";
  import ProfileLeft from "$lib/sections/profile/ProfileLeft.svelte";
  import EditProfile from "$lib/sections/profile/EditProfile.svelte";
  import ContactsLeft from "$lib/sections/contacts/ContactsLeft.svelte";
  import ContactsMain from "$lib/sections/contacts/ContactsMain.svelte";
  import SettingsLeft from "$lib/sections/settings/SettingsLeft.svelte";
  import SettingsMain from "$lib/sections/settings/SettingsMain.svelte";
  import WalletLeft from "$lib/sections/wallet/WalletLeft.svelte";
  import WalletMain from "$lib/sections/wallet/WalletMain.svelte";
  import MarketMain from "$lib/sections/market/MarketMain.svelte";

  let activeSection = $state('home');
  let isConnecting = $state(false);
  let isConnected = $state(true);
  let isLoggedIn = $state(false);
  let displayName = $state("Tauri User");
  let hasProfiles = $state(true);


  function handleNavigate(section: string) {
    activeSection = section;
  }

  onMount(async () => {
    // Принудительно загружаем переводы для текущего пути
    await loadTranslations(i18n.locale || 'en', '/playground');
  });


  // Ctrl+Q для закрытия окна
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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


  function handleLogin() {
    isLoggedIn = true;
    activeSection = 'home';
  }



</script>

{#if !isLoggedIn}
  <div class="h-screen w-screen bg-background flex items-center justify-center">
    <MainEntryScreen onLogin={handleLogin} {hasProfiles} />
  </div>
{:else}
  <div class="h-screen w-screen flex bg-background text-foreground overflow-hidden font-sans">
    <SidebarIcons bind:activeSection />

    <div class="flex-1 h-full overflow-hidden">
      <PaneGroup direction="horizontal" class="h-full">

        <!-- LEFT PANEL -->
        <Pane defaultSize={30} minSize={20} class="h-full">
          {#if activeSection === 'home'}
            <HomeLeft />
          {:else if activeSection === 'profile'}
            <ProfileLeft {isConnecting} {isConnected} {isLoggedIn} {displayName} />
          {:else if activeSection === 'contacts'}
            <ContactsLeft />
          {:else if activeSection === 'settings'}
            <SettingsLeft />

          {:else if activeSection === 'wallet'}
            <WalletLeft onNavigate={handleNavigate} />
          {:else if activeSection === 'saved-addresses'}
            <div class="p-4 border-r border-border bg-card h-full flex flex-col">
              <div class="font-bold text-lg text-primary mb-4">Saved addresses</div>
              <p class="text-sm text-muted-foreground">Список сохраненных адресов появится здесь.</p>
              <button onclick={() => activeSection = 'wallet'} class="mt-4 text-sm text-primary hover:underline">← Back to Wallet</button>
            </div>
          {:else if activeSection === 'onchain-friends'}
            <div class="p-4 border-r border-border bg-card h-full flex flex-col">
              <div class="font-bold text-lg text-primary mb-4">Onchain friends</div>
              <p class="text-sm text-muted-foreground">Список друзей появится здесь.</p>
              <button onclick={() => activeSection = 'wallet'} class="mt-4 text-sm text-primary hover:underline">← Back to Wallet</button>
            </div>
          {:else if activeSection === 'market'}
            <div class="p-4 border-r border-border bg-card h-full">
              <div class="font-bold text-lg text-primary">Market</div>
            </div>
          {:else}
            <ProfileLeft {isConnecting} {isConnected} {isLoggedIn} {displayName} />
          {/if}
        </Pane>

        <PaneResizer class="w-1 bg-border hover:bg-primary transition-colors cursor-col-resize" />

        <!-- MAIN PANEL -->
        <Pane defaultSize={70} class="h-full bg-card">
          {#if activeSection === 'home'}
            <HomeMain />
          {:else if activeSection === 'profile'}
            <EditProfile />
          {:else if activeSection === 'contacts'}
            <ContactsMain />
          {:else if activeSection === 'settings'}
            <SettingsMain />
          {:else if activeSection === 'market'}
            <MarketMain />
          {:else if activeSection === 'wallet'}
            <WalletMain />
          {:else if activeSection === 'saved-addresses'}
            <div class="h-full flex items-center justify-center bg-card text-muted-foreground">
              Saved Addresses (Coming Soon)
            </div>
          {:else if activeSection === 'onchain-friends'}
            <div class="h-full flex items-center justify-center bg-card text-muted-foreground">
              Onchain Friends (Coming Soon)
            </div>
          {:else}
            <ComingSoon />
          {/if}
        </Pane>
      </PaneGroup>
    </div>
  </div>
{/if}
