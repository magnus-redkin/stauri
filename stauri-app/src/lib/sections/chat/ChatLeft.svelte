<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { SvelteSet } from 'svelte/reactivity';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { chatsState, setSelectedChat, joinByInput, removeChat } from '$lib/stores/chatsStore.svelte';
  import { removeFeed, feedChatItems } from '$lib/stores/feedsStore.svelte';

  let { onSelectChat }: { onSelectChat?: (chat: ChatItem) => void } = $props();

  let searchQuery = $state('');

  /** Результат последнего подключения — показывается под полем. */
  let joinMessage = $state<{ kind: 'ok' | 'pending' | 'error'; text: string } | null>(null);

  export type ChatItem = {
    id: string;
    name: string;
    lastMessage: string;
    /**
     * `direct` — личная переписка, `community` — канал внутри сообщества,
     * `external` — источник провайдера (см. docs/ru/providers_and_dapps.md).
     *
     * `channel` — публичный канал status-go, оставлен только для уже
     * существующих чатов. Создавать новые из интерфейса нельзя: у такого
     * канала нет владельца, его нельзя закрыть, переименовать или найти по
     * каталогу, и в модели АКК он не выражает «канал с автором».
     */
    type: 'direct' | 'channel' | 'community' | 'external';
    isPendingRequest?: boolean;
    unreadCount?: number;
    /** Для каналов сообществ: к какому сообществу и категории относятся. */
    communityId?: string;
    communityName?: string;
    categoryId?: string;
    /** Можно ли писать. Для канала без права постинга ввод не показывается. */
    canPost?: boolean;
    /** Внешний источник: чей элемент и откуда он пришёл. */
    source?: string;
    sourceUrl?: string;
  };

  /**
   * Поиск по списку чатов.
   *
   * Ищем и по имени сообщества: у канала внутри сообщества `name` — это
   * только имя канала (`general`), а название сообщества лежит в
   * `communityName`. Без этой ветки ввод `stauri-akk-test-1131` не находил
   * ничего, хотя канал видён под заголовком с этим именем.
   */
  const filteredItems = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return chatsState.items;
    return chatsState.items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q) ||
      (i.communityName || '').toLowerCase().includes(q)
    );
  });

  /**
   * Подписки на внешние ленты как элементы списка чатов.
   *
   * Живут отдельно от `chatsState.items`, потому что приходят не из
   * status-go, а из `localStorage`. Склеиваем их здесь, а не в
   * `chatsStore`: тот стор отвечает за «что вернул бэкенд», и подмешивать
   * туда чужие данные значило бы смешать два источника в одном месте.
   *
   * Новые сверху: свежедобавленная лента должна быть видна сразу, а не
   * искаться в конце списка.
   */
  const feedItems = $derived.by(() => {
    // Форму строки строит `feedsStore`: она нужна ещё и в `selectChat`,
    // который открывает ленту по id из другого раздела.
    const items: ChatItem[] = feedChatItems();

    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q) ||
        (i.source || '').toLowerCase().includes(q)
    );
  });

  /**
   * Строки списка: подписки сверху, затем чаты.
   *
   * Порядок задаём мы, а не источник (docs §9.3): подписки — отдельный
   * блок, и канал сообщества не может их вытеснить.
   */
  const allItems = $derived([...feedItems, ...filteredItems]);

  /**
   * Свёрнутые сообщества: id -> true.
   *
   * `SvelteSet` даёт реактивность на add/delete без пересоздания коллекции.
   * По умолчанию всё развёрнуто: скрывать каналы пользователь не просил.
   */
  const collapsed = new SvelteSet<string>();

  /**
   * Список с заголовками групп сообществ.
   *
   * Плоский массив: элементы сообществ идут блоком, перед каждым блоком —
   * заголовок с именем сообщества. Так список остаётся одномерным (быстрее
   * и проще для поиска), но визуально разделён.
   *
   * Свёрнутая группа отдаёт только заголовок: каналы под ней не попадают в
   * вывод. При поиске свёрнутость игнорируется — иначе ввод не находил бы
   * то, что пользователь сам спрятал, и это выглядело бы как поломка.
   */
  const groupedItems = $derived.by(() => {
    const searching = searchQuery.trim().length > 0;
    const out: Array<{ kind: 'header'; id: string; label: string } | { kind: 'item'; item: ChatItem }> = [];
    const seen = new SvelteSet<string>();

    for (const item of allItems) {
      if (item.type === 'community' && item.communityId) {
        if (!seen.has(item.communityId)) {
          seen.add(item.communityId);
          out.push({
            kind: 'header',
            id: item.communityId,
            label: item.communityName || item.communityId,
          });
        }
        // Скрываем каналы свёрнутой группы, но не во время поиска.
        if (!searching && collapsed.has(item.communityId)) continue;
      }
      out.push({ kind: 'item', item });
    }
    return out;
  });

  function toggleGroup(communityId: string) {
    if (collapsed.has(communityId)) collapsed.delete(communityId);
    else collapsed.add(communityId);
  }

  function select(item: ChatItem) {
    setSelectedChat(item);
    onSelectChat?.(item);
  }

  /** Подтверждение удаления: действие необратимо для истории. */
  let confirmRemove = $state<ChatItem | null>(null);

  async function doRemove() {
    const item = confirmRemove;
    if (!item) return;
    confirmRemove = null;

    // Внешняя подписка живёт у нас, а не в бэкенде: `removeChat` отправил бы
    // `deactivateChat` с несуществующим id и ничего не удалил.
    if (item.type === 'external') {
      if (item.sourceUrl) removeFeed(item.sourceUrl);
      if (chatsState.selected?.id === item.id) setSelectedChat(null);
      return;
    }

    const res = await removeChat(item);
    if (!res.ok) {
      joinMessage = { kind: 'error', text: res.error || 'Failed to remove' };
    }
  }

  /**
   * Подключается к сообществу или каналу по введённой строке.
   *
   * Разбор «что это» — на стороне стора (`joinByInput`): пользователь вводит
   * то, что у него есть (ссылку или 0x-id), а не выбирает тип из списка.
   *
   * Для сообщества результатом будет `spectated`, а не `joined`: вступление
   * требует выбора раскрываемых адресов и пароля, поэтому оно живёт на
   * экране превью, а не в этом поле.
   */
  async function submitJoin() {
    if (!searchQuery.trim() || chatsState.isJoining) return;

    joinMessage = null;
    const result = await joinByInput(searchQuery);

    if (result.status === 'joined') {
      joinMessage = { kind: 'ok', text: i18n.t('Joined') + ': ' + result.name };
      searchQuery = '';
    } else if (result.status === 'requested') {
      joinMessage = { kind: 'pending', text: i18n.t('Request sent') + ': ' + result.name };
      searchQuery = '';
    } else if (result.status === 'spectated') {
      joinMessage = { kind: 'ok', text: i18n.t('Opened for viewing') + ': ' + result.name };
      searchQuery = '';
    } else {
      joinMessage = { kind: 'error', text: result.error };
    }
  }
</script>

<div class="flex flex-col h-full border-r border-border bg-card">
  <div class="p-4 border-b border-border">
    <span class="font-bold text-lg text-primary">{i18n.t('Chat')}</span>
  </div>

  {#if joinMessage}
    <div
      class="px-3 py-2 text-sm border-b border-border {joinMessage.kind === 'error'
        ? 'bg-destructive/10 text-destructive'
        : joinMessage.kind === 'pending'
          ? 'bg-orange-100 text-orange-700'
          : 'bg-secondary text-foreground'}"
    >
      {joinMessage.text}
    </div>
  {/if}

  <!--
    Одно поле на два действия.

    Раньше здесь было два почти одинаковых поля: отдельная форма «Join»
    за кнопкой «+» и ниже — поиск. Пользователь не знал, куда вставлять
    ссылку, а оба поля выглядели одинаково.

    Теперь ввод либо фильтрует список (пока это похоже на имя), либо
    подключает (если это ссылка или 0x-идентификатор). Разбор — в
    `joinByInput`, Enter — подключение.
  -->
  <div class="p-2 border-b border-border">
    <input
      bind:value={searchQuery}
      placeholder={i18n.t('Search or paste invite link')}
      onkeydown={(e) => { if (e.key === 'Enter') submitJoin(); }}
      class="w-full h-9 border border-input rounded-md px-3 text-sm bg-background"
      aria-label={i18n.t('Search or paste invite link')}
    />
    {#if searchQuery.trim()}
      <button
        onclick={submitJoin}
        disabled={chatsState.isJoining}
        class="mt-2 w-full h-8 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50"
      >
        {chatsState.isJoining ? i18n.t('Connecting...') : i18n.t('Connect by link')}
      </button>
    {/if}
  </div>

  <!--
    `min-h-0` обязателен: во flex-контейнере потомок по умолчанию не может
    сжаться ниже своего содержимого (`min-height: auto`). Без него список
    каналов распирал панель и не прокручивался — весь скролл уходил за
    пределы окна.
  -->
  <ScrollArea class="flex-1 min-h-0">
    {#if chatsState.isLoading}
      <p class="p-4 text-muted-foreground text-sm">{i18n.t('Loading chats...')}</p>
    {:else if filteredItems.length === 0}
      <p class="p-4 text-muted-foreground text-sm italic">{i18n.t('No chats yet')}</p>
    {:else}
      <div class="p-2 space-y-1">
        {#each groupedItems as entry (entry.kind === 'header' ? 'h-' + entry.id : entry.item.id)}
          {#if entry.kind === 'header'}
            <!--
              Заголовок группы — кнопка: сообщество можно свернуть, чтобы
              его каналы не вытесняли остальное. У шести сообществ из
              каталога каналов было столько, что панель не пролистывалась
              даже с исправленным скроллом — свернуть проще, чем искать.
            -->
            <button
              onclick={() => toggleGroup(entry.id)}
              class="w-full flex items-center gap-1 px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
              aria-expanded={!collapsed.has(entry.id)}
            >
              <span class="shrink-0">{collapsed.has(entry.id) ? '▸' : '▾'}</span>
              <span class="truncate">{entry.label}</span>
            </button>
          {:else}
            {@const item = entry.item}
            <div class="group/row relative">
              <button
                onclick={() => select(item)}
                class="w-full text-left p-3 pr-8 rounded-md hover:bg-secondary transition-colors {chatsState.selected?.id === item.id ? 'bg-secondary' : ''}"
              >
                <div class="flex items-center gap-2">
                  {#if item.isPendingRequest}
                    <div class="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-lg">!</div>
                  {:else if item.type === 'channel'}
                    <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">#</div>
                  {:else if item.type === 'community'}
                    <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">◇</div>
                  {:else if item.type === 'external'}
                    <div class="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground">📡</div>
                  {:else}
                    <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">
                      {item.name ? item.name.substring(0, 1).toUpperCase() : '?'}
                    </div>
                  {/if}
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-foreground truncate">{item.name || item.id.slice(0, 8)}</span>
                      {#if (item.unreadCount ?? 0) > 0}
                        <span class="ml-auto shrink-0 text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">
                          {item.unreadCount}
                        </span>
                      {/if}
                    </div>
                    <div class="text-xs text-muted-foreground truncate">{item.lastMessage || ''}</div>
                    {#if item.type === 'external' && item.source}
                      <!--
                        Происхождение внешнего элемента показывается всегда и не
                        отключается: по docs/ru/providers_and_dapps.md §9.2 это
                        часть строки, а не необязательный бейдж.
                      -->
                      <div class="text-[0.625rem] text-muted-foreground/70 truncate">↗ {item.source}</div>
                    {/if}
                  </div>
                </div>
              </button>

              <!--
                Убрать из списка. Показывается при наведении, но не на
                сенсорных экранах: там hover нет, поэтому кнопка должна
                быть видна всегда, если основной ввод — касание.
              -->
              <button
                onclick={(e) => { e.stopPropagation(); confirmRemove = item; }}
                class="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 focus:opacity-100 hover:text-destructive transition-opacity"
                title={i18n.t('Remove from list')}
                aria-label={i18n.t('Remove from list')}
              >
                ×
              </button>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </ScrollArea>

  <!--
    Подтверждение удаления.

    Спрашиваем, потому что `preserveHistory: false` стирает историю чата
    безвозвратно: вернуть канал в список можно только повторным вступлением,
    а сообщения при этом уже не восстановятся.
  -->
  {#if confirmRemove}
    <div class="p-3 border-t border-border bg-secondary/40 space-y-2">
      <p class="text-xs text-foreground">
        {i18n.t('Remove from list and delete local history?')}
      </p>
      <p class="text-[0.6875rem] text-muted-foreground truncate">
        {confirmRemove.communityName ? confirmRemove.communityName + ' / ' : ''}{confirmRemove.name}
      </p>
      <div class="flex gap-2">
        <button
          onclick={doRemove}
          class="flex-1 px-3 py-1.5 rounded-md bg-destructive text-white text-xs"
        >
          {i18n.t('Remove')}
        </button>
        <button
          onclick={() => { confirmRemove = null; }}
          class="px-3 py-1.5 rounded-md border border-border text-xs hover:bg-secondary"
        >
          {i18n.t('Cancel')}
        </button>
      </div>
    </div>
  {/if}
</div>
