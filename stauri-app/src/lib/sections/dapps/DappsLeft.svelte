<script lang="ts">
  /**
   * Левя панель раздела dApp — список внешних источников.
   *
   * По `docs/ru/providers_and_dapps.md` здесь живут провайдеры: они отдают
   * **данные**, не код. Пока два: каталог сообществ Status и лента по URL
   * (RSS/Atom либо публичная страница Telegram-канала).
   *
   * Отдельного раздела «Сообщества» больше нет: браузер каталога — это
   * провайдер, а не основная сущность. Подключение по-прежнему выполняем мы.
   */
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { dappsState, selectProvider, removeProvider } from '$lib/stores/dappsStore.svelte';

  const providers = $derived(dappsState.providers);
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border">
    <span class="font-bold text-lg text-primary">{i18n.t('dApps')}</span>
  </div>

  <ScrollArea class="flex-1 min-h-0">
    <div class="p-2 space-y-1">
      {#each providers as provider (provider.kind)}
        <div class="group/row relative">
          <button
            onclick={() => selectProvider(provider.kind)}
            class="w-full text-left p-3 pr-8 rounded-md hover:bg-secondary transition-colors {dappsState.active === provider.kind ? 'bg-secondary' : ''}"
          >
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                {provider.icon}
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-foreground truncate">{i18n.t(provider.title)}</div>
                <div class="text-xs text-muted-foreground truncate">{i18n.t(provider.subtitle)}</div>
              </div>
            </div>
          </button>

          {#if provider.removable}
            <button
              onclick={(e) => { e.stopPropagation(); removeProvider(provider.kind); }}
              class="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 focus:opacity-100 hover:text-destructive transition-opacity"
              title={i18n.t('Remove')}
              aria-label={i18n.t('Remove')}
            >
              ×
            </button>
          {/if}
        </div>
      {/each}

      {#if providers.length === 0}
        <p class="p-4 text-muted-foreground text-sm italic">{i18n.t('No sources yet')}</p>
      {/if}
    </div>
  </ScrollArea>
</div>
