<script lang="ts">
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { i18n } from "$lib/i18n";
  import { checkForUpdate, installUpdate, restartApp } from "$lib/stores/updater";
  import {
    uiState,
    setFontSize,
    setTheme,
    FONT_MIN,
    FONT_MAX,
  } from "$lib/stores/uiStore.svelte";

  /**
   * Тема и размер шрифта живут в `uiStore`, а не здесь.
   *
   * Раньше они читались и применялись только этим экраном: до первого
   * открытия Настроек интерфейс выглядел по умолчанию, хотя значение в
   * `localStorage` уже было другим. Теперь применяет стор при старте, а
   * экран только показывает и меняет текущее значение.
   */
  const theme = $derived(uiState.theme);
  const fontSize = $derived(uiState.fontSize);

  /**
   * Состояние проверки обновлений.
   *
   * `idle` — ещё не проверяли: при открытии настроек сеть не дёргаем, чтобы
   * не тратить запросы и не задерживать появление экрана.
   */
  const updateState = $state<{
    status: 'idle' | 'checking' | 'available' | 'uptodate' | 'installing' | 'installed' | 'error';
    currentVersion: string | null;
    version: string | null;
    notes: string | null;
    error: string | null;
  }>({
    status: 'idle',
    currentVersion: null,
    version: null,
    notes: null,
    error: null,
  });

  onMount(() => {
    // Тему и размер шрифта уже применил `loadUiPreferences` при старте, здесь
    // их применять заново не нужно — только версия.

    // Версию берём из манифеста приложения, а не из package.json: в бандл
    // попадает значение из tauri.conf.json, и именно оно управляет тем,
    // какое обновление сервер сочтёт новее.
    getVersion()
      .then((v) => { updateState.currentVersion = v; })
      .catch(() => { updateState.currentVersion = 'unknown'; });
  });

  async function handleCheckUpdate() {
    updateState.status = 'checking';
    updateState.error = null;

    const { update, error } = await checkForUpdate();

    if (error) {
      updateState.status = 'error';
      updateState.error = error;
    } else if (update) {
      updateState.status = 'available';
      updateState.version = update.version;
      updateState.notes = update.notes;
      if (!updateState.currentVersion) updateState.currentVersion = update.currentVersion;
    } else {
      updateState.status = 'uptodate';
      updateState.version = null;
      updateState.notes = null;
    }
  }

  async function handleInstallUpdate() {
    updateState.status = 'installing';
    updateState.error = null;
    try {
      await installUpdate();
      // На Linux файл подменяется на месте: текущий процесс продолжает
      // работать со старым кодом, поэтому честно просим перезапуск.
      updateState.status = 'installed';
    } catch (e) {
      updateState.status = 'error';
      updateState.error = String(e);
    }
  }

  async function handleRestart() {
    // Управление не возвращается: процесс завершается и стартует заново.
    // Вызываем через Rust, а не location.reload(): перезагрузка страницы
    // не подменила бы образ, а обработчик выхода в Rust не отработал бы.
    try {
      await restartApp();
    } catch (e) {
      updateState.status = 'error';
      updateState.error = String(e);
    }
  }

  function changeLanguage(newLocale: string) {
    i18n.locale = newLocale;
    localStorage.setItem('stauri-locale', newLocale);
  }
</script>

<div class="h-full overflow-y-auto p-8 bg-background">
  <div class="max-w-2xl mx-auto space-y-8">
    <!-- Заголовок -->
    <h1 class="text-3xl font-bold text-primary">{i18n.t('Settings')}</h1>

    <!-- Язык -->
    <div class="space-y-2">
      <label class="font-medium text-foreground">{i18n.t('Language')}</label>
      <div class="flex gap-2">
        <button
          class="px-4 py-2 rounded-md border border-border {i18n.locale === 'en' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => changeLanguage('en')}
        >
          English
        </button>
        <button
          class="px-4 py-2 rounded-md border border-border {i18n.locale === 'ru' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => changeLanguage('ru')}
        >
          Русский
        </button>
        <button
          class="px-4 py-2 rounded-md border border-border {i18n.locale === 'zh' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => changeLanguage('zh')}
        >
          中文
        </button>
        <button
          class="px-4 py-2 rounded-md border border-border {i18n.locale === 'es' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => changeLanguage('es')}
          >
          Español
        </button>
      </div>
    </div>

    <!-- Тема -->
    <div class="space-y-2">
      <label class="font-medium text-foreground">{i18n.t('Theme')}</label>
      <div class="flex gap-2">
        <button
          class="px-4 py-2 rounded-md border border-border {theme === 'maroon' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => setTheme('maroon')}
        >
          {i18n.t('Maroon')}
        </button>
        <button
          class="px-4 py-2 rounded-md border border-border {theme === 'light' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => setTheme('light')}
        >
          {i18n.t('Light')}
        </button>
        <button
          class="px-4 py-2 rounded-md border border-border {theme === 'dark' ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary'}"
          onclick={() => setTheme('dark')}
        >
          {i18n.t('Dark')}
        </button>
      </div>
    </div>

    <!-- Шрифт -->
    <div class="space-y-2">
      <label class="font-medium text-foreground">{i18n.t('Font Size')}</label>
      <div class="flex items-center gap-4">
        <input
          type="range"
          min={FONT_MIN}
          max={FONT_MAX}
          value={fontSize}
          oninput={(e) => setFontSize(Number((e.target as HTMLInputElement).value))}
          class="w-full accent-primary"
        />
        <span class="font-mono text-sm">{fontSize}px</span>
      </div>
    </div>

    <!-- Обновления -->
    <div class="space-y-2">
      <label class="font-medium text-foreground" for="app-version">{i18n.t('Version')}</label>
      <div class="flex items-center gap-4 flex-wrap">
        <span id="app-version" class="font-mono text-sm text-muted-foreground">
          {(updateState.currentVersion ?? '…')}
        </span>
        <button
          class="px-4 py-2 rounded-md border border-border bg-card hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={updateState.status === 'checking' || updateState.status === 'installing'}
          onclick={handleCheckUpdate}
        >
          {updateState.status === 'checking' ? i18n.t('Checking...') : i18n.t('Check for updates')}
        </button>
        {#if updateState.status === 'available'}
          <button
            class="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90"
            onclick={handleInstallUpdate}
          >
            {i18n.t('Install')} {updateState.version}
          </button>
        {/if}
      </div>

      {#if updateState.status === 'available'}
        <p class="text-sm text-foreground">{i18n.t('Update available')}: {updateState.version}</p>
        {#if updateState.notes}
          <pre class="text-xs text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">{updateState.notes}</pre>
        {/if}
      {:else if updateState.status === 'uptodate'}
        <p class="text-sm text-muted-foreground">{i18n.t('You are up to date')}</p>
      {:else if updateState.status === 'installing'}
        <p class="text-sm text-foreground">{i18n.t('Installing...')}</p>
      {:else if updateState.status === 'installed'}
        <div class="flex items-center gap-4 flex-wrap">
          <p class="text-sm text-foreground">{i18n.t('Restart required')}</p>
          <button
            class="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90"
            onclick={handleRestart}
          >
            {i18n.t('Restart')}
          </button>
        </div>
      {:else if updateState.status === 'error'}
        <p class="text-sm text-destructive break-words">{updateState.error}</p>
        <button
          class="px-3 py-1 rounded-md border border-border bg-card hover:bg-secondary text-sm"
          onclick={handleCheckUpdate}
        >
          {i18n.t('Retry')}
        </button>
      {/if}
    </div>
  </div>
</div>
