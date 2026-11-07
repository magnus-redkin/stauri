/**
 * Внешние источники (ленты), которые пользователь добавил сам.
 *
 * ## Почему отдельный стор, а не `dappsState.feeds`
 *
 * `dappsState.feeds` — это «что я сейчас смотрю в разделе dApp». Здесь —
 * «на что я подписан». Разница видна сразу: подписка живёт между
 * перезапусками и показывается в списке чатов, а открытая в панели лента —
 * нет.
 *
 * Раньше добавление ленты никуда не сохранялось: пользователь вставлял
 * адрес, видел элементы в панели dApp, перезапускал Stauri — и всё
 * пропадало. Теперь добавление создаёт запись в списке чатов с пометкой
 * «внешний», как и договорено в docs/ru/providers_and_dapps.md §9.
 *
 * ## Почему localStorage
 *
 * У бэкенда нет таблицы для внешних источников: status-go хранит только
 * чаты Status, и заводить там запись для чужого RSS значило бы соврать
 * модели данных. Настройки приложения (тема, язык) уже живут в
 * `localStorage`, и это тот же класс состояния.
 *
 * Ограничение известно: `localStorage` привязан к webview, то есть подписки
 * не переживут смену профиля. Когда появится своё хранилище настроек
 * (после перехода на Logos), переедет туда.
 *
 * ## Инварианты из документа
 *
 * * происхождение элемента показывается всегда (§9.2);
 * * один сломанный источник не ломает остальные (§13);
 * * порядок задаём мы, а не источник (§9.3).
 */

import { SvelteMap } from 'svelte/reactivity';
import { invoke } from '@tauri-apps/api/core';
import { debug, info, warn } from '$lib/utils/log';
import { formatError } from '$lib/utils/errors';

/** Элемент ленты — то же, что отдаёт `fetch_feed` в Rust. */
export interface FeedItem {
  url: string;
  title: string;
  summary: string;
  /** Время публикации в миллисекундах, если удалось разобрать. */
  published_at: number | null;
}

/** Ответ `fetch_feed`. */
export interface FeedResponse {
  title: string;
  items: FeedItem[];
  /** Чей это элемент: `t.me/<name>` или хост. Показывается всегда. */
  source: string;
}

/** Подписка: адрес и последнее удачно загруженное содержимое. */
export interface FeedSubscription {
  /** Адрес, по которому загружается лента. Ключ и id чата. */
  url: string;
  /** Название канала из самого фида, иначе хост. */
  title: string;
  /** Происхождение: `t.me/<name>` или хост. Показывается в списке. */
  source: string;
  items: FeedItem[];
  /** Когда обновляли последний раз (мс). */
  fetchedAt: number;
  /** Ошибка последнего обновления; пустая — всё в порядке. */
  error: string;
}

const STORAGE_KEY = 'stauri:feeds';

/**
 * Версия формата сохранённых подписок.
 *
 * ## Зачем
 *
 * В данных на диске лежат отрывки, которые были обрезаны СТАРОЙ версией
 * разбора: Rust дописывал «…» в саму строку, и такой отрывок нельзя было
 * раскрыть по клику — текста дальше просто не оставалось. Правка разбора не
 * исправляет уже сохранённые записи, поэтому при чтении хранилища старой
 * версии подписки перезагружаются с сервера.
 *
 * Версия 1 — отрывок до 400 символов с «…» внутри строки.
 * Версия 2 — отрывок до 4000 символов, сокращение только вёрсткой.
 *
 * Версию поднимать при любом изменении формы `FeedItem`, которое нельзя
 * исправить на лету: иначе пользователь видит старые данные и думает, что
 * код не работает.
 */
const STORAGE_VERSION = 2;

/** Что записывается на диск: версия и сами подписки. */
interface StoredFeeds {
  version: number;
  feeds: FeedSubscription[];
}

/** Сколько элементов храним на источник. Совпадает с лимитом в Rust. */
const MAX_STORED_ITEMS = 50;

/**
 * Хост RSSHub, на который переписываются адреса `rsshub.app`.
 *
 * ## Почему не `rsshub.app` напрямую
 *
 * Публичный `rsshub.app` закрыл программный доступ: на обычный запрос он
 * отвечает `403` с текстом «restrict access ... for some feed readers ...
 * intended for testing purposes only», а с браузерным User-Agent — страницей
 * Cloudflare «Just a moment…». Проверено вживую. Ссылки в инструкциях
 * (`rsshub.app/telegram/channel/…`, `/discord/channel/…`, `/twitter/user/…`)
 * при этом правильные — меняется только хост.
 *
 * Поэтому адрес с этим хостом переписывается на публичное зеркало, которое
 * маршруты отдаёт. Зашито временно: зеркало может умереть так же, как
 * исходный домен, и тогда константа меняется здесь, в одном месте.
 *
 * ## Ограничение, о котором лучше знать
 *
 * Работают не все маршруты: `telegram/channel/<name>` отдаёт ленту,
 * а `twitter/user/<name>` и `discord/channel/<id>` отвечают `503` — им нужны
 * ключи соответствующей сети, и зеркало их не подставляет. Это не наша
 * ошибка, и обход не наша задача; пользователь увидит сообщение о сбое.
 */
export const RSSHUB_MIRROR = 'rsshub.rssforever.com';

/** Домены RSSHub, которые переписываются на зеркало. */
const RSSHUB_HOSTS = ['rsshub.app', 'www.rsshub.app'];

/**
 * Рабочие ленты для подсказки внизу панели.
 *
 * ## Зачем список, а не просто текст
 *
 * Пользователь не знает, какой адрес вставить первым, и на пустом поле
 * пробовать нечего. Проверенные примеры дают точку входа: нажал — адрес
 * оказался в поле, нажал Enter — лента в списке чатов.
 *
 * ## Почему именно эти
 *
 * Все проверены запросом 2026-11-06: отдают `200` и валидный RSS/Atom.
 * Разные по типу намеренно — блог с редкими постами, научный журнал, новости,
 * агрегатор ссылок, — чтобы было видно, что формат подходит не только для
 * одного вида сайтов.
 *
 * `blog.ethereum.org/feed.xml` отвечает `301` на `/en/feed.xml`; HTTP-клиент
 * проходит редирект сам, поэтому адрес оставлен в привычном виде.
 */
export const FEED_EXAMPLES = [
  'https://blog.rust-lang.org/feed.xml',
  'https://www.nature.com/nature.rss',
  'https://blog.ethereum.org/feed.xml',
  'https://news.ycombinator.com/rss',
  'https://lwn.net/headlines/rss',
  'https://github.blog/feed/',
  'https://www.theverge.com/rss/index.xml',
  'https://changelog.com/feed',
] as const;

export const feedsState = $state({
  /**
   * Подписки по URL.
   *
   * `SvelteMap`, а не объект: список читается в шаблоне списка чатов, и
   * обычный объект не отслеживался бы реактивностью.
   */
  subscriptions: new SvelteMap<string, FeedSubscription>(),
  /** Идёт проверка и загрузка нового адреса. */
  isAdding: false,
  /** Ошибка последнего добавления — для формы. */
  error: '',
  loaded: false,
});

/**
 * Читает подписки с диска.
 *
 * Ошибку чтения не пробрасываем: испорченное хранилище не должно мешать
 * приложению запуститься. Стираем и начинаем с пустого списка — потерять
 * подписки неприятно, но тихо падающий раздел хуже.
 *
 * ## Почему старая версия перечитывается с сервера
 *
 * В версии 1 отрывок обрезался на 400 символах с «…» внутри строки, и
 * раскрыть его по клику было нельзя — текста дальше не оставалось. Правка
 * разбора не чинит уже сохранённые записи, поэтому подписки старой версии
 * попадают в `stale` и перезагружаются сразу после чтения. Пользователь
 * видит правильный текст без ручных действий.
 */
export function loadFeeds(): void {
  if (feedsState.loaded) return;
  feedsState.loaded = true;

  if (typeof localStorage === 'undefined') return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    // Формат 1 — голый массив, формат 2 — объект с версией. Понимаем оба:
    // у существующих пользователей на диске лежит массив, и терять их
    // подписки при обновлении нельзя.
    const parsed = JSON.parse(raw) as StoredFeeds | FeedSubscription[];
    const version = Array.isArray(parsed) ? 1 : parsed?.version ?? 1;
    const feeds = Array.isArray(parsed) ? parsed : parsed?.feeds ?? [];

    for (const feed of feeds) {
      // Проверяем форму записи: файл на диске могли править руками, а
      // шаблон списка читает `items` и `title` без проверок.
      if (!feed || typeof feed.url !== 'string' || !Array.isArray(feed.items)) continue;
      feedsState.subscriptions.set(feed.url, {
        url: feed.url,
        title: feed.title || feed.url,
        source: feed.source || '',
        items: feed.items,
        fetchedAt: feed.fetchedAt || 0,
        error: feed.error || '',
      });
    }

    info(`[feeds] loaded ${feedsState.subscriptions.size} subscription(s), v${version}`);

    if (version < STORAGE_VERSION) {
      info('[feeds] storage is outdated, refetching subscriptions');
      // Не ждём: список чатов должен появиться сразу, с уже сохранёнными
      // заголовками. Обновление подменит отрывки под ним.
      void refreshFeeds();
    }
  } catch (e) {
    warn('[feeds] failed to read subscriptions, starting empty:', e);
  }
}

function persist(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const payload: StoredFeeds = {
      version: STORAGE_VERSION,
      feeds: [...feedsState.subscriptions.values()],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    // Переполнение квоты или запрет записи: подписки продолжат работать до
    // перезапуска, но не сохранятся. Сообщаем в лог, а не молчим.
    warn('[feeds] failed to persist subscriptions:', e);
  }
}

/**
 * Добавляет подписку: проверяет адрес и сохраняет его.
 *
 * ## Что значит «корректный RSS»
 *
 * Проверка целиком в Rust (`fetch_feed`): там фильтр адреса и разбор
 * XML. Ошибка здесь — это и есть ответ на «это не лента»: страница HTML,
 * 404, Cloudflare-заглушка или пустой фид без записей. Фронтенд не решает,
 * можно ли ходить по адресу, и не пытается разобрать ответ сам.
 *
 * ## Почему адрес нормализуется до проверки
 *
 * Пользователь копирует ссылку из каталога или вставляет `@name`. Проверять
 * сырой ввод значило бы отклонять то, что человек считает рабочим адресом.
 */
export async function addFeed(raw: string): Promise<{ ok: boolean; error?: string }> {
  const url = normalizeFeedUrl(raw);
  if (!url) {
    feedsState.error = 'Enter an RSS/Atom URL';
    return { ok: false, error: feedsState.error };
  }

  feedsState.isAdding = true;
  feedsState.error = '';
  try {
    const res = await invoke<FeedResponse>('fetch_feed', { url });

    // Пустой фид — не повод добавлять запись: в списке чатов она выглядела
    // бы как канал, в котором ничего нет, и пользователь не понял бы, что
    // сломалось.
    if (!res.items.length) {
      throw new Error('The feed is empty: no items found');
    }

    const subscription: FeedSubscription = {
      url,
      title: res.title || hostOf(url),
      source: res.source || hostOf(url),
      items: res.items.slice(0, MAX_STORED_ITEMS),
      fetchedAt: Date.now(),
      error: '',
    };

    feedsState.subscriptions.set(url, subscription);
    persist();
    info(`[feeds] added ${url} (${res.items.length} items)`);
    return { ok: true };
  } catch (e) {
    const error = formatError(e);
    feedsState.error = error;
    warn(`[feeds] add ${url} failed:`, e);
    return { ok: false, error };
  } finally {
    feedsState.isAdding = false;
  }
}

/**
 * Перечитывает все подписки.
 *
 * Ошибка одного источника не должна ломать остальные (§13): результат
 * записывается в запись этой подписки, остальные остаются как были.
 */
export async function refreshFeeds(): Promise<void> {
  for (const [url, current] of [...feedsState.subscriptions.entries()]) {
    try {
      const res = await invoke<FeedResponse>('fetch_feed', { url });
      if (!res.items.length) continue;
      feedsState.subscriptions.set(url, {
        ...current,
        title: res.title || current.title,
        source: res.source || current.source,
        items: res.items.slice(0, MAX_STORED_ITEMS),
        fetchedAt: Date.now(),
        error: '',
      });
    } catch (e) {
      feedsState.subscriptions.set(url, { ...current, error: formatError(e) });
      debug(`[feeds] refresh ${url} failed:`, e);
    }
  }
  persist();
}

/** Убирает подписку. Сообщения в ней и так не наши — удалять нечего. */
export function removeFeed(url: string): void {
  if (!feedsState.subscriptions.delete(url)) return;
  persist();
  info(`[feeds] removed ${url}`);
}

/** id чата для подписки: `feed:` + адрес. */
export function feedChatId(url: string): string {
  return `feed:${url}`;
}

/** Адрес подписки по id чата (или `null`, если это не подписка). */
export function feedUrlFromChatId(chatId: string): string | null {
  return chatId.startsWith('feed:') ? chatId.slice('feed:'.length) : null;
}

/**
 * Подписка в виде строки списка чатов.
 *
 * ## Почему здесь, а не в `ChatLeft`
 *
 * Строку нужно строить в двух местах: список чатов и `selectChat`, который
 * открывает чат по id из другого раздела. Если бы форма жила только в
 * компоненте, открытие ленты из панели dApp не нашло бы её в `chatsState` и
 * молча ничего не выбрало.
 *
 * Форма полей совпадает с `ChatItem`; импортировать тип оттуда нельзя —
 * компонент зависит от сторов, а не наоборот, поэтому возвращаем
 * структурно совместимый объект.
 */
export function feedChatItem(feed: FeedSubscription) {
  return {
    id: feedChatId(feed.url),
    name: feed.title,
    lastMessage: feed.error
      ? `Update failed: ${feed.error}`
      : feed.items[0]?.title || '',
    type: 'external' as const,
    source: feed.source,
    sourceUrl: feed.url,
  };
}

/** Все подписки как строки списка, свежие сверху. */
export function feedChatItems() {
  return [...feedsState.subscriptions.values()]
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
    .map(feedChatItem);
}

/**
 * Приводит ввод к URL.
 *
 * Принимаем то, что пользователь реально вставляет:
 *   * полный `http(s)`-адрес — как есть (это основной путь: RSSHub,
 *     собственный RSS, лента сайта);
 *   * ссылку на Telegram-канал (`t.me/name`, `t.me/s/name`, `@name`) —
 *     превращаем не в `t.me/s/…`, а в маршрут зеркала RSSHub
 *     (`…/telegram/channel/name`). Причина в том, что готовая HTML-страница
 *     `t.me/s/` разбирается хрупко и может отдаваться только браузеру, а
 *     маршрут RSSHub отдаёт настоящий RSS и работает одинаково для любого
 *     канала. Для Telegram это единственное исключение из «вставляйте
 *     адрес ленты»;
 *   * остальное — ошибка ввода, а не молчаливая попытка.
 *
 * Адрес на `rsshub.app` переписывается на зеркало (см. [`RSSHUB_MIRROR`]):
 * публичный домен больше не отдаёт ленты программам, а маршруты в
 * инструкциях указаны именно с ним, поэтому отклонять такой ввод было бы
 * неверно — человек скопировал рабочий пример.
 */
export function normalizeFeedUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    // Ссылка на канал Telegram, вставленная целиком: `https://t.me/name`
    // или `https://t.me/s/name`. Переводим на маршрут зеркала.
    const tgUrl = value.match(
      /^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]+)\/?$/i
    );
    if (tgUrl) return telegramFeedUrl(tgUrl[1]);
    return rewriteRsshub(value);
  }

  const tg = value.match(
    /^(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]+)\/?$/i
  );
  if (tg) return telegramFeedUrl(tg[1]);

  const handle = value.match(/^@([A-Za-z0-9_]{4,})$/);
  if (handle) return telegramFeedUrl(handle[1]);

  return null;
}

/** Маршрут RSSHub для публичного Telegram-канала, уже на зеркале. */
export function telegramFeedUrl(channel: string): string {
  return `https://${RSSHUB_MIRROR}/telegram/channel/${channel}`;
}

/**
 * Меняет хост `rsshub.app` на зеркало, сохраняя путь и запрос.
 *
 * Возвращает исходную строку, если хост другой или разбор не удался:
 * отказ нормализации здесь означал бы «адрес неверный», хотя он верный —
 * просто не RSSHub.
 */
export function rewriteRsshub(url: string): string {
  try {
    const parsed = new URL(url);
    if (!RSSHUB_HOSTS.includes(parsed.hostname.toLowerCase())) return url;
    parsed.hostname = RSSHUB_MIRROR;
    // Схема остаётся прежней: зеркало работает по https, но если
    // пользователь вставил http — не превращаем его ввод в другой адрес
    // молча, кроме хоста.
    return parsed.toString();
  } catch {
    return url;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function resetFeeds(): void {
  // Подписки НЕ чистим: они принадлежат пользователю и переживают выход из
  // аккаунта. Сброс — только рабочее состояние формы.
  feedsState.isAdding = false;
  feedsState.error = '';
}
