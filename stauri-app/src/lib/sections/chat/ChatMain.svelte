<script lang="ts">
  import { i18n } from '$lib/i18n';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import {
    getChatMessages,
    sendChatMessage,
    acceptContactRequest,
    isReply,
  } from '$lib/status/messaging';
  import { statusState } from '$lib/stores/statusStore.svelte';
  import { chatsState, loadChats } from '$lib/stores/chatsStore.svelte';
  import { feedsState } from '$lib/stores/feedsStore.svelte';
  import { formatMessageText } from '$lib/utils/user';
  import { formatError } from '$lib/utils/errors';
  import { debug, error } from '$lib/utils/log';
  import { invoke } from '@tauri-apps/api/core';

  let messages = $state<any[]>([]);
  let inputText = $state('');
  let isLoading = $state(false);
  let isAccepting = $state(false);

  /**
   * Раскрытые записи ленты.
   *
   * `SvelteSet` реактивен сам, поэтому не оборачивается в `$state` и не
   * переприсваивается — переприсваивание потеряло бы подписки. Состояние
   * живёт в компоненте и не сохраняется: это «посмотреть сейчас», а не
   * настройка.
   */
  const expandedItems = new SvelteSet<string>();

  function toggleItem(key: string) {
    if (expandedItems.has(key)) expandedItems.delete(key);
    else expandedItems.add(key);
  }

  /**
   * Открывает адрес системным обработчиком.
   *
   * Не `<a target="_blank">`: в WebKitGTK внутри Tauri-окна такой переход
   * часто не делает ничего, потому что webview не обязан открывать окна.
   * И не `plugin-shell.open`: он требует разрешения `shell:allow-open` в
   * capabilities, а такое разрешение дало бы любой XSS в интерфейсе право
   * запускать чужие программы. Команда `open_external` проверяет схему в
   * Rust и там же пробует открыть Telegram-ссылку в самом Telegram.
   */
  async function openExternal(url: string) {
    try {
      await invoke('open_external', { url });
    } catch (e) {
      // Не наш контент: ошибка открытия не должна ломать ленту. Адрес
      // показан рядом целиком, его можно открыть руками.
      error('[chat] failed to open link', e);
    }
  }

  /**
   * Записи канала и комментарии к ним — из одного и того же списка.
   *
   * ## Почему разделение на клиенте
   *
   * Комментарий — обычное сообщение с непустым `responseTo`, лежащее в той
   * же таблице с тем же `local_chat_id`. `MessageByChatID` фильтрует
   * `response_to` только через `thread_id`, а этот фильтр отключён при
   * выключенных threads:
   *
   * > If threads are disabled, then we are backwards compatible and messages
   * > in threads are treated as normal messages, so we don't filter them out.
   *
   * Проверено живьём (docs/ru/akk_scheme.md §12): ответ приходит в общем
   * списке. Поэтому без разделения здесь комментарии висели бы в ленте как
   * обычные сообщения.
   */
  const posts = $derived(messages.filter((m) => !isReply(m)));

  /** Комментарии, сгруппированные по id родительской записи. */
  const repliesByParent = $derived.by(() => {
    // `SvelteMap`, а не `Map`: множество читается в шаблоне, и обычная Map
    // не отслеживается реактивностью Svelte (`prefer-svelte-reactivity`).
    const map = new SvelteMap<string, any[]>();
    for (const msg of messages) {
      if (!isReply(msg)) continue;
      const parent = msg.responseTo as string;
      const list = map.get(parent);
      if (list) list.push(msg);
      else map.set(parent, [msg]);
    }
    return map;
  });

  /**
   * Можно ли писать в выбранный чат.
   *
   * Внешний источник только читается: писать некуда, и поле ввода
   * отсутствует вовсе, а не отключено без объяснения
   * (docs/ru/providers_and_dapps.md §9.2).
   *
   * `canPost === false` — канал сообщества, куда мы не можем писать. Это
   * ровно случай просматриваемого сообщества (spectate): сообщения уже
   * читаются, но `Community.CanPost` для неучастника возвращает `false`.
   * Без этой проверки в просмотре показывалось бы поле ввода, а отправка
   * падала бы на сервере.
   */
  const canWrite = $derived(
    !!chatsState.selected &&
      chatsState.selected.type !== 'external' &&
      !chatsState.selected.isPendingRequest &&
      chatsState.selected.canPost !== false
  );

  /** Сообщество выбранного канала — нужно для отправки сообщения. */
  const communityId = $derived(chatsState.selected?.communityId || '');

  /**
   * Подписка, если выбран внешний источник.
   *
   * Внешний чат не существует в бэкенде: его id — `feed:<url>`, а содержимое
   * лежит в `feedsState`. Поэтому сообщения берём не из `messages`, а прямо
   * из подписки, и загрузка истории ниже для него не запускается.
   */
  const feed = $derived.by(() => {
    const chat = chatsState.selected;
    if (!chat || chat.type !== 'external') return null;
    const url = chat.sourceUrl || chat.id.replace(/^feed:/, '');
    return feedsState.subscriptions.get(url) ?? null;
  });

  // Загружаем историю при смене чата
  $effect(() => {
    const chat = chatsState.selected;
    if (!chat || chat.isPendingRequest || chat.type === 'external' || !statusState.backendPort) {
      messages = [];
      return;
    }
    isLoading = true;
    messages = [];

    getChatMessages(statusState.backendPort, chat.id)
      .then(res => {
        messages = res.messages;
        debug(`[chat] ${chat.id}: loaded ${res.messages.length} messages`);
      })
      .catch((e) => { error(`[chat] ${chat.id}: load messages failed`, e); })
      .finally(() => isLoading = false);
  });

  /**
   * Своё ли это сообщение.
   *
   * Бэкенд не пишет `from: 'me'` — там публичный ключ отправителя. Поэтому
   * сравниваем с `statusState.publicKey`. Запасной признак — `outgoingStatus`:
   * status-go заполняет его только у исходящих (`sending`/`sent`/`delivered`),
   * и это единственный надёжный признак до того, как ключ профиля загружен.
   *
   * Раньше после отправки сообщение добавлялось локально с `from: 'me'`, а
   * после перезагрузки истории приходило с ключом и отрисовывалось как чужое —
   * справа, а потом слева.
   */
  function isOwn(msg: any): boolean {
    if (!msg) return false;
    if (msg.from === 'me') return true;
    if (msg.outgoingStatus) return true;
    const own = statusState.publicKey;
    return !!own && msg.from === own;
  }

  async function send() {
    const chat = chatsState.selected;
    if (!inputText.trim() || !chat || !canWrite || !statusState.backendPort) return;
    const text = inputText;
    inputText = '';
    try {
      const res = await sendChatMessage(statusState.backendPort, chat.id, text, communityId);
      // Бэкенд возвращает в `result.messages` и новое сообщение, и родителя.
      // Для обычной записи просто добавляем оптимистичную копию: ответ
      // подтянется при следующей загрузке истории.
      const sent = (res?.result?.messages || []).find(
        (m: any) => !isReply(m) && m.text === text
      );
      messages = [
        ...messages,
        sent || { text, from: statusState.publicKey || 'me', timestamp: Date.now(), outgoingStatus: 'sending' },
      ];
    } catch (e) {
      error(`[chat] ${chat.id}: send failed`, e);
      statusState.errorMsg = "Failed to send message";
    }
  }

  async function acceptRequest() {
    const chat = chatsState.selected;
    if (!chat || !statusState.backendPort) return;
    isAccepting = true;
    try {
      await acceptContactRequest(statusState.backendPort, chat.id);
      await loadChats(true); // Перезагружаем чаты
    } catch (e: any) {
      statusState.errorMsg = `Failed to accept request: ${formatError(e)}`;
    } finally {
      isAccepting = false;
    }
  }
</script>

<div class="h-full flex flex-col bg-card">
  {#if !chatsState.selected}
    <div class="flex items-center justify-center h-full text-muted-foreground">
      {i18n.t('Select a chat')}
    </div>
  {:else}
    <!-- Заголовок -->
    <div class="p-4 border-b border-border flex items-center gap-2">
      {#if chatsState.selected.communityName}
        <span class="text-xs text-muted-foreground truncate">{chatsState.selected.communityName} /</span>
      {/if}
      <span class="font-bold text-primary truncate">{chatsState.selected.name}</span>
      {#if chatsState.selected.type === 'external'}
        <span class="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded">
          {i18n.t('External source')}
        </span>
      {/if}
      {#if chatsState.selected.isPendingRequest}
        <span class="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded">{i18n.t('Contact Request')}</span>
      {/if}
    </div>

    {#if chatsState.selected.isPendingRequest}
      <!-- Экран запроса -->
      <div class="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <div class="w-16 h-16 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-3xl">!</div>
        <p class="text-center text-sm text-muted-foreground">"{chatsState.selected.lastMessage}"</p>
        <div class="flex gap-3">
          <button onclick={acceptRequest} disabled={isAccepting} class="px-4 py-2 bg-primary text-primary-foreground rounded-md">
            {isAccepting ? i18n.t('Accepting...') : i18n.t('Accept')}
          </button>
        </div>
      </div>
    {:else if chatsState.selected.type === 'external'}
      <!--
        Внешняя лента. Отдельная ветка, потому что сообщений в бэкенде у неё
        нет: элементы приходят из RSS/Atom и лежат в `feedsState`.

        Текст свёрнут через `line-clamp`, а не обрезан в данных: сокращение —
        вёрстка, поэтому клик по записи показывает её целиком, без повторной
        загрузки. Разметку источника в `{@html}` не пускаем (docs §9.5).
      -->
      <!--
        `min-h-0` обязателен: внутри `flex flex-col` потомок по умолчанию
        имеет `min-height: auto` и не сжимается, поэтому список рос бы за
        пределы панели вместо прокрутки. Отступы — на внутреннем `div`:
        прокручиваемая область в ScrollArea занимает `size-full` от корня,
        и `p-4` на самом ScrollArea съедал бы высоту (тот же отказ, что был
        в панели dApp).
      -->
      <ScrollArea class="flex-1 min-h-0">
        <div class="p-4">
        {#if !feed}
          <p class="text-muted-foreground text-sm italic">{i18n.t('Feed not found')}</p>
        {:else if feed.error && feed.items.length === 0}
          <p class="text-destructive text-sm">{feed.error}</p>
        {:else if feed.items.length === 0}
          <p class="text-muted-foreground text-sm italic">{i18n.t('No items in this feed')}</p>
        {:else}
          <div class="space-y-3">
            {#each feed.items as item (item.url || item.title)}
              {@const key = item.url || item.title}
              {@const open = expandedItems.has(key)}
              <div class="p-3 rounded-md bg-secondary/40">
                {#if item.summary}
                  <!--
                    Свёрнутая запись — кнопка: клик раскрывает текст. Ссылка
                    внутри кнопки недопустима, поэтому ниже, под текстом,
                    стоит отдельная кнопка-источник.
                  -->
                  <button
                    onclick={() => toggleItem(key)}
                    class="w-full text-left"
                    aria-expanded={open}
                  >
                    <div class="text-sm font-medium text-foreground">{item.title}</div>
                    <div
                      class="text-xs text-muted-foreground mt-1 {open ? 'whitespace-pre-wrap' : 'line-clamp-4'} break-words"
                    >
                      {item.summary}
                    </div>
                    {#if !open}
                      <div class="text-[0.625rem] text-primary mt-1">{i18n.t('Show more')}</div>
                    {/if}
                  </button>
                {:else}
                  <div class="text-sm font-medium text-foreground">{item.title}</div>
                {/if}

                <div class="flex items-center gap-2 mt-2">
                  {#if item.published_at}
                    <span class="text-[0.625rem] text-muted-foreground shrink-0">
                      {new Date(item.published_at).toLocaleString()}
                    </span>
                  {/if}
                  {#if item.url}
                    <!--
                      Источник открывается командой Rust, а не переходом:
                      `target="_blank"` внутри Tauri-окна в WebKitGTK часто
                      не делает ничего. Полный адрес в `title` — чтобы его
                      можно было прочитать и скопировать, если обработчик
                      не найдётся.
                    -->
                    <button
                      onclick={() => openExternal(item.url!)}
                      class="text-[0.625rem] text-primary hover:underline truncate max-w-[60%] text-left"
                      title={item.url}
                    >
                      {i18n.t('Open source')}: {item.url}
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
        </div>
      </ScrollArea>
    {:else}
      <!-- История. Та же причина `min-h-0` и отступов на внутреннем `div`. -->
      <ScrollArea class="flex-1 min-h-0">
        <div class="p-4">
        {#if isLoading}
          <p class="text-muted-foreground text-sm">{i18n.t('Loading messages...')}</p>
        {:else if posts.length === 0}
          <p class="text-muted-foreground text-sm italic">{i18n.t('No messages yet.')}</p>
        {:else}
          <div class="space-y-3">
            {#each posts as post (post.id)}
              {@const replies = repliesByParent.get(post.id) || []}
              <div class="space-y-1">
                <!-- Запись канала -->
                <div class="flex {isOwn(post) ? 'justify-end' : 'justify-start'}">
                  <div class="max-w-[70%] p-2 rounded-lg {isOwn(post) ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}">
                    {formatMessageText(post.text, chatsState.contacts)}
                  </div>
                </div>

                <!--
                  Комментарии под записью.

                  Показываем факт, а не число: серверного счётчика нет, а
                  считать по загруженной странице значило бы врать («7
                  комментариев» может означать «7 из загруженных»).
                  См. docs/ru/akk_scheme.md §9.3.
                -->
                {#if replies.length > 0}
                  <div class="pl-4 space-y-1">
                    {#each replies as reply (reply.id)}
                      <div class="flex gap-2 text-sm">
                        <span class="text-muted-foreground shrink-0">↳</span>
                        <div class="{isOwn(reply) ? 'text-primary' : 'text-foreground'}">
                          {formatMessageText(reply.text, chatsState.contacts)}
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
        </div>
      </ScrollArea>

      <!-- Ввод -->
      {#if canWrite}
        <div class="p-4 border-t border-border flex gap-2">
          <input
            bind:value={inputText}
            placeholder={i18n.t('Type a message...')}
            onkeydown={(e) => { if (e.key === 'Enter') send(); }}
            class="flex-1 px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button onclick={send} class="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
            {i18n.t('Send')}
          </button>
        </div>
      {:else if chatsState.selected.canPost === false}
        <div class="p-4 border-t border-border text-sm text-muted-foreground">
          {i18n.t('You cannot post in this channel')}
        </div>
      {/if}
    {/if}
  {/if}
</div>
