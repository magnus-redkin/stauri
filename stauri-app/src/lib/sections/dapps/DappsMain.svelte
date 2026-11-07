<script lang="ts">
  /**
   * Правая панель раздела dApp.
   *
   * Сверху — строка адреса: введённый здесь dApp открывается в отдельном
   * окне (`dapp.rs`), а не внутри этой панели. У чужого интерфейса нет
   * доступа к нашему дереву компонентов и IPC: его окно не перечислено в
   * capabilities, поэтому `invoke` из чужой страницы не работает.
   *
   * Ниже, пока провайдер не выбран, — список примеров. В нём смешаны три
   * вида, и для пользователя это одно и то же место со списком: встроенный
   * экран (каталог), настоящее внешнее приложение и запись, которая лишь
   * подставляет адрес провайдера. Разница в том, где открывается интерфейс.
   *
   * Два провайдера, каждый со своим слотом:
   *   * `communities` — каталог сообществ; подключение выполняем мы
   *     (`spectateCommunity`), провайдер только отдаёт адреса;
   *   * `feed` — лента по URL; элементы только читаются, ссылки открываются
   *     явными кнопками с полным адресом.
   *
   * Разметка провайдера никогда не попадает в `{@html}` (docs §9.5): только
   * текст и отдельные ссылки.
   */
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    dappsState,
    dappExamples,
    openDapp,
    activateExample,
    resetDappsView,
  } from '$lib/stores/dappsStore.svelte';
  import {
    feedsState,
    addFeed,
    loadFeeds,
    RSSHUB_MIRROR,
    FEED_EXAMPLES,
  } from '$lib/stores/feedsStore.svelte';
  import {
    communitiesState,
    filteredEntries,
    loadCommunities,
    selectCommunity,
    openChannel,
    channelTree,
  } from '$lib/stores/communitiesStore.svelte';
  import JoinCommunity from './JoinCommunity.svelte';

  const entries = $derived(filteredEntries());

  /**
   * Сообщества, раскрытые в дерево.
   *
   * `SvelteSet` реактивен сам, поэтому не оборачивается в `$state` и не
   * переприсваивается — иначе сломались бы подписки (та же причина, что в
   * `ChatLeft`).
   */
  const expanded = new SvelteSet<string>();

  function toggleExpanded(id: string) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
  }

  /** Каналы открытого сообщества: категории и то, что внутри. */
  const tree = $derived(channelTree(communitiesState.selected?.community));

  let channelError = $state('');

  /**
   * Раскрытая форма вступления.
   *
   * Отдельное состояние, а не флаг в `communitiesState`: это состояние
   * интерфейса, а не данных. Сбрасывается при смене сообщества — форма
   * с паролем от другого сообщества вводила бы в заблуждение.
   */
  let joining = $state(false);

  /**
   * Поле адреса dApp.
   *
   * Фокус ставится сам, когда экран примеров открывается: это первое, что
   * пользователь делает в разделе, и лишний клик ему не нужен. `$effect`
   * срабатывает в том числе при возврате из каталога — раздел один и тот же,
   * а экран меняется.
   */
  let dappInput = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (dappsState.active === null) dappInput?.focus();
  });

  /**
   * Поле адреса ленты.
   *
   * Тот же принцип: открыли провайдер — курсор уже в поле, вставлять можно
   * сразу. Раньше приходилось кликать, хотя других действий на этом экране
   * нет.
   */
  let feedInput = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (dappsState.active === 'feed') feedInput?.focus();
  });

  /** Запрос из `+page.svelte`: переключить раздел и выбрать чат. */
  let { onOpenChat }: { onOpenChat?: (chatId: string) => void } = $props();

  /**
   * Добавляет ленту и сразу открывает её в чате.
   *
   * Переключение раздела — не украшение: добавление проверяет адрес и, если
   * он рабочий, создаёт запись в списке чатов. Оставить пользователя в панели
   * провайдера значило бы заставить его искать, куда делось добавленное.
   */
  async function submitFeed() {
    if (feedsState.isAdding) return;
    const res = await addFeed(dappsState.feedUrl);
    if (!res.ok) return;

    const raw = dappsState.feedUrl.trim();
    dappsState.feedUrl = '';
    // Адрес мог быть нормализован (`@name` → `t.me/s/name`), поэтому id
    // берём из сохранённой подписки, а не из ввода.
    const added = [...feedsState.subscriptions.keys()].find(
      (url) => url === raw || url.endsWith(raw)
    );
    if (added) onOpenChat?.(`feed:${added}`);
  }

  async function handleChannelClick(entry: any, channelId: string) {
    channelError = '';
    const res = await openChannel(entry, channelId);
    if (res.ok && res.chatId) onOpenChat?.(res.chatId);
    else if (!res.ok) channelError = res.error || i18n.t('Channel is not readable');
  }
</script>

<div class="h-full flex flex-col bg-card">
  {#if dappsState.active === null}
    <div class="flex-1 flex flex-col min-h-0">
      <!--
        Строка адреса стоит только здесь, на экране примеров.

        Раньше она висела над панелью всегда — и в провайдере ленты рядом
        оказывались два поля ввода: адрес dApp и адрес ленты. Пользователь
        не мог понять, куда что вставлять, и вставлял адрес канала Telegram
        в поле dApp. Поле — часть экрана «выбрать, что открыть», а не общая
        шапка раздела.
      -->
      <div class="p-2 border-b border-border space-y-2">
        <div class="flex gap-2">
          <input
            bind:value={dappsState.dappUrl}
            placeholder={i18n.t('dApp address (https://...)')}
            onkeydown={(e) => { if (e.key === 'Enter') openDapp(); }}
            class="flex-1 h-9 border border-input rounded-md px-3 text-sm bg-background"
          />
          <button
            onclick={() => openDapp()}
            disabled={!dappsState.dappUrl.trim()}
            class="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50 shrink-0"
          >
            {i18n.t('Open')}
          </button>
        </div>
        {#if dappsState.dappError}
          <p class="text-xs text-destructive">{dappsState.dappError}</p>
        {/if}
        <!--
          Предупреждение неотключаемое (docs §12): пользователь должен знать,
          что чужое окно не имеет доступа к Stauri, но и мы не отвечаем за
          его содержимое. Показываем всегда, а не однократно — «больше не
          спрашивать» здесь означало бы «забыть, что это чужой код».
        -->
        <p class="text-[0.6875rem] text-muted-foreground">
          {i18n.t('External dApps open in a separate window and cannot reach Stauri or your keys.')}
        </p>
      </div>

      <div class="p-4 border-b border-border">
        <span class="font-bold text-lg text-primary">{i18n.t('dApps')}</span>
        <p class="text-xs text-muted-foreground mt-1">
          {i18n.t('Built-in ones stay in Stauri; external ones open in a separate window.')}
        </p>
      </div>

      <div class="p-2 border-b border-border space-y-2">
        <div class="flex gap-2">
          <input
            bind:value={dappsState.dappUrl}
            bind:this={dappInput}
            placeholder={i18n.t('dApp address (https://...)')}
            onkeydown={(e) => { if (e.key === 'Enter') openDapp(); }}
            class="flex-1 h-9 border border-input rounded-md px-3 text-sm bg-background"
          />
          <button
            onclick={() => openDapp()}
            disabled={!dappsState.dappUrl.trim()}
            class="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50 shrink-0"
          >
            {i18n.t('Open')}
          </button>
        </div>
        {#if dappsState.dappError}
          <p class="text-xs text-destructive">{dappsState.dappError}</p>
        {/if}
        <!--
          Предупреждение неотключаемое (docs §12): пользователь должен знать,
          что чужое окно не имеет доступа к Stauri, но и мы не отвечаем за
          его содержимое. Показываем всегда, а не однократно — «больше не
          спрашивать» здесь означало бы «забыть, что это чужой код».
        -->
        <p class="text-[0.6875rem] text-muted-foreground">
          {i18n.t('External dApps open in a separate window and cannot reach Stauri or your keys.')}
        </p>
      </div>

      <div class="p-4 border-b border-border">
        <span class="font-bold text-primary">{i18n.t('Examples of dApps')}</span>
      </div>

      <ScrollArea class="flex-1 min-h-0">
        <div class="p-2 space-y-1">
          {#each dappExamples as example (example.id)}
            <button
              onclick={() => activateExample(example)}
              class="w-full text-left p-3 rounded-md hover:bg-secondary transition-colors"
            >
              <div class="flex items-center gap-2">
                <span class="text-base shrink-0">{example.icon}</span>
                <span class="font-medium text-foreground truncate">{i18n.t(example.title)}</span>
                <span class="text-[0.625rem] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  {example.kind === 'builtin'
                    ? i18n.t('Built-in')
                    : example.kind === 'external'
                      ? i18n.t('External')
                      : i18n.t('Provider')}
                </span>
              </div>
              <div class="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {i18n.t(example.subtitle)}
              </div>
            </button>
          {/each}
        </div>
      </ScrollArea>
    </div>

  {:else if dappsState.active === 'communities'}
    <div class="p-3 border-b border-border flex items-center gap-2">
      <!--
        Назад к примерам. Раздел остаётся тем же (`dapps`), меняется только
        внутренний экран — поэтому это не навигация приложения, а возврат
        внутри компонента.
      -->
      <button
        onclick={() => resetDappsView()}
        class="p-1.5 rounded-md border border-border hover:bg-secondary shrink-0"
        aria-label={i18n.t('Back')}
        title={i18n.t('Back')}
      >
        ←
      </button>
      <div class="flex-1 min-w-0">
        <span class="font-bold text-primary">{i18n.t('Community directory')}</span>
        <p class="text-xs text-muted-foreground mt-1">
          {i18n.t('Addresses come from the provider. Joining is done by Stauri.')}
        </p>
      </div>
      <button
        onclick={() => loadCommunities(true)}
        disabled={communitiesState.isLoading}
        class="text-xs px-2 py-1 rounded-md border border-border hover:bg-secondary disabled:opacity-50 shrink-0"
        aria-label={i18n.t('Refresh')}
        title={i18n.t('Refresh')}
      >
        ⟳
      </button>
    </div>

    <div class="p-2 border-b border-border">
      <input
        bind:value={communitiesState.query}
        placeholder={i18n.t('Search communities')}
        class="w-full h-9 border border-input rounded-md px-3 text-sm bg-background"
      />
    </div>

    <ScrollArea class="flex-1 min-h-0">
      <div class="p-2">
        {#if entries.length === 0}
          <p class="p-4 text-muted-foreground text-sm italic">
            {communitiesState.isLoading ? i18n.t('Loading communities...') : i18n.t('No communities found')}
          </p>
        {:else}
          <div class="space-y-1">
            {#each entries as entry (entry.id)}
              <div>
                <!--
                  Строка сообщества. Кнопка раскрывает дерево, а не сразу
                  выполняет spectate: пользователь должен увидеть, что внутри,
                  до того как мы что-то запишем в базу status-go.
                -->
                <button
                  onclick={async () => {
                    toggleExpanded(entry.id);
                    if (!expanded.has(entry.id)) return;
                    // Раскрытие требует описания: каналов без него нет.
                    if (!entry.loaded) await selectCommunity(entry);
                    else if (!entry.joined && !entry.spectated) await selectCommunity(entry);
                  }}
                  class="w-full text-left p-3 rounded-md hover:bg-secondary transition-colors {communitiesState.selected?.id === entry.id ? 'bg-secondary' : ''}"
                  aria-expanded={expanded.has(entry.id)}
                >
                  <div class="flex items-center gap-2">
                    <span class="shrink-0 text-muted-foreground text-xs">
                      {expanded.has(entry.id) ? '▾' : '▸'}
                    </span>
                    <span class="text-primary text-xs font-bold">◇</span>
                    <span class="font-medium text-foreground truncate">
                      {entry.name || entry.id.slice(0, 12) + '…'}
                    </span>
                    {#if entry.joined}
                      <span class="text-[0.625rem] px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                        {i18n.t('Joined')}
                      </span>
                    {/if}
                  </div>
                  <div class="text-xs text-muted-foreground truncate mt-0.5 pl-5">
                    {#if !entry.loaded}
                      {i18n.t('Loading description...')}
                    {:else}
                      {entry.access === 'open'
                        ? i18n.t('Open')
                        : entry.access === 'token'
                          ? i18n.t('Token gated')
                          : i18n.t('By request')}
                      {#if entry.activeMembersCount}
                        · {entry.activeMembersCount} {i18n.t('members')}
                      {/if}
                    {/if}
                  </div>
                </button>

                {#if expanded.has(entry.id) && communitiesState.selected?.id === entry.id}
                  <div class="pl-6 pr-2 pb-2 space-y-1">
                    {#if communitiesState.isBusy}
                      <p class="text-xs text-muted-foreground italic px-2 py-1">
                        {i18n.t('Loading channels...')}
                      </p>
                    {:else if tree.length === 0}
                      <p class="text-xs text-muted-foreground italic px-2 py-1">
                        {i18n.t('No channels')}
                      </p>
                    {:else}
                      {#each tree as group (group.id)}
                        {#if group.name}
                          <p class="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground px-2 pt-1">
                            {group.name}
                          </p>
                        {/if}
                        {#each group.channels as channel (channel.id)}
                          <button
                            onclick={() => handleChannelClick(entry, channel.id)}
                            disabled={communitiesState.isBusy || !channel.canView}
                            class="w-full text-left px-2 py-1.5 rounded-md hover:bg-secondary transition-colors disabled:opacity-50 flex items-center gap-2"
                          >
                            <span class="text-primary text-xs shrink-0">#</span>
                            <span class="text-sm text-foreground truncate">{channel.name}</span>
                            {#if channel.tokenGated}
                              <span class="text-[0.625rem] text-muted-foreground shrink-0">
                                {i18n.t('Token gated')}
                              </span>
                            {:else if !channel.canView}
                              <span class="text-[0.625rem] text-muted-foreground shrink-0">
                                {i18n.t('Hidden until you join')}
                              </span>
                            {:else if !channel.canPost}
                              <span class="text-[0.625rem] text-muted-foreground shrink-0">
                                {i18n.t('Read only')}
                              </span>
                            {/if}
                          </button>
                        {/each}
                      {/each}
                    {/if}

                    {#if channelError}
                      <p class="text-xs text-destructive px-2">{channelError}</p>
                    {/if}

                    <!--
                      Вступление — отдельным действием: без него канал
                      читается, но писать нельзя, а заявка требует выбора
                      адресов и пароля.
                    -->
                    {#if !entry.joined}
                      <button
                        onclick={() => { joining = !joining; }}
                        class="w-full text-left px-2 py-1.5 rounded-md text-xs text-primary hover:bg-secondary transition-colors"
                        aria-expanded={joining}
                      >
                        {joining
                          ? i18n.t('Cancel')
                          : i18n.t('Join community to post') + ' →'}
                      </button>

                      {#if joining}
                        <!--
                          Форма готовит себя сама при монтировании: адреса и
                          проверку токен-гейта. Родителю не нужно знать про
                          её внутреннее состояние.
                        -->
                        <JoinCommunity onDone={() => { joining = false; }} />
                      {/if}
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </ScrollArea>

  {:else if dappsState.active === 'feed'}
    <div class="p-3 border-b border-border flex items-center gap-2">
      <!--
        Тот же возврат, что и в каталоге: без него из ленты тоже нельзя было
        выйти, кроме как повторным кликом по иконке раздела. Две разные
        кнопки в одном компоненте не должны вести себя по-разному.
      -->
      <button
        onclick={() => resetDappsView()}
        class="p-1.5 rounded-md border border-border hover:bg-secondary shrink-0"
        aria-label={i18n.t('Back')}
        title={i18n.t('Back')}
      >
        ←
      </button>
      <div class="flex-1 min-w-0">
        <span class="font-bold text-primary">{i18n.t('Channel feed')}</span>
        <p class="text-xs text-muted-foreground mt-1">
          {i18n.t('Only text is shown. Links open separately and show the full address.')}
        </p>
      </div>
    </div>

    <div class="p-3 border-b border-border space-y-2">
      <div class="flex gap-2">
        <input
          bind:value={dappsState.feedUrl}
          bind:this={feedInput}
          placeholder={i18n.t('RSS/Atom URL or a Telegram link (t.me/...)')}
          onkeydown={(e) => { if (e.key === 'Enter') submitFeed(); }}
          class="flex-1 h-9 border border-input rounded-md px-3 text-sm bg-background"
        />
        <button
          onclick={submitFeed}
          disabled={feedsState.isAdding || !dappsState.feedUrl.trim()}
          class="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50 shrink-0"
        >
          {feedsState.isAdding ? i18n.t('Checking...') : i18n.t('Add')}
        </button>
      </div>

      <!--
        Ошибка — это и есть ответ «это не лента»: страница HTML, 404,
        Cloudflare-заглушка или пустой фид. Подпись под ней объясняет, что
        делать дальше, а не только констатирует провал.
      -->
      {#if feedsState.error}
        <p class="text-xs text-destructive">{feedsState.error}</p>
        <p class="text-[0.6875rem] text-muted-foreground">
          {i18n.t('The address must return RSS or Atom, or be a Telegram channel link. Use a feed source such as RSSHub for networks that do not publish one.')}
        </p>
      {/if}

      <!--
        Подсказка про зеркало: `rsshub.app` больше не отдаёт ленты программам,
        поэтому ссылки из каталога маршрутов сами по себе не работают. Мы их
        переписываем автоматически, но пользователю полезно видеть, куда
        уходит запрос — и знать, какие маршруты у зеркала действительно живые.
      -->
      <p class="text-[0.6875rem] text-muted-foreground">
        {i18n.t('RSSHub links (rsshub.app) are sent through a mirror, {mirror}. Telegram channel links are converted to that mirror automatically; some networks need keys and currently fail.', { mirror: RSSHUB_MIRROR })}
      </p>

      <p class="text-[0.6875rem] text-muted-foreground">
        {i18n.t('A working feed is added to the chat list as an external source.')}
      </p>

      <!--
        Примеры внизу, а не в подсказке под полем: это то, что нужно
        попробовать руками, а не прочитать. Клик подставляет адрес в поле —
        дальше Enter, и лента в списке чатов.
      -->
      <div class="pt-2 border-t border-border">
        <p class="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          {i18n.t('RSS examples')}
        </p>
        <div class="space-y-0.5">
          {#each FEED_EXAMPLES as example (example)}
            <button
              onclick={() => { dappsState.feedUrl = example; feedInput?.focus(); }}
              class="block w-full text-left text-[0.6875rem] text-primary hover:underline truncate"
              title={example}
            >
              {example}
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>
