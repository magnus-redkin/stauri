/**
 * Раздел «Сообщества» — каталог, превью и вступление.
 *
 * ## Почему отдельный стор
 *
 * Список чатов и раздел сообществ работают с разными вопросами:
 *   * чаты отвечают «что у меня уже есть»;
 *   * сообщества — «что существует и как туда попасть».
 *
 * Совместить их в одном сторе значило бы держать в `ChatItem` поля, которые
 * нужны только превью (каталог, доступ, состояние заявки), а в каталоге —
 * поля чата. Здесь каталог и превью, в `chatsStore` — то, что отображается
 * в списке чатов.
 *
 * ## Каталог — не готовый список
 *
 * `wakuext_curatedCommunities` возвращает карту описаний только для тех
 * сообществ, чьё описание уже лежит в базе, и отдельно `unknownCommunities`
 * с id, которые status-go догружает фоном. Поэтому первый вызов часто даёт
 * пустую карту при непустом списке id — это нормальное состояние, а не
 * ошибка. Мы показываем такие записи «без названия» и обновляем их, когда
 * статус-го пришлёт описание.
 */

import { statusState } from './statusStore.svelte';
import {
  communityAccess,
  getCuratedCommunities,
  getCommunities,
  fetchCommunity,
  spectateCommunity,
  checkPermissionsToJoinCommunity,
  generateJoiningRequestsForSigning,
  signJoinRequestData,
  requestToJoinCommunity,
  communityChatId,
} from '$lib/status/messaging';
import { getAccounts } from '$lib/status/api';
import { chatsState, loadChats } from './chatsStore.svelte';
import { subscribeChannel, unsubscribeChannel } from './chatSubscriptions.svelte';
import { debug, info, warn } from '$lib/utils/log';
import { formatError } from '$lib/utils/errors';
import type { Community, CommunityAccess, CommunityChat } from '$lib/status/types';

/** Запись каталога: описание может быть ещё не загружено. */
export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  access: CommunityAccess;
  /** Избранное в контракте — SIM показывает это первым. */
  featured: boolean;
  /** Описание уже получено; иначе доступно только id. */
  loaded: boolean;
  joined: boolean;
  spectated: boolean;
  activeMembersCount?: number;
  community?: Community;
}

/**
 * Узел дерева каталога: категория (или «без категории») и её каналы.
 *
 * Категории в status-go — это `Community.categories` с `position`, а канал
 * ссылается на свою категорию через `categoryID`. Пустая строка в
 * `categoryID` означает «канал вне категорий» — такие в SIM лежат отдельной
 * группой сверху, и здесь так же.
 */
export interface ChannelGroup {
  id: string;
  name: string;
  channels: CommunityChatNode[];
}

export interface CommunityChatNode {
  id: string;
  name: string;
  canView: boolean;
  canPost: boolean;
  tokenGated: boolean;
  /** Чат уже есть в списке чатов — повторно добавлять нечего. */
  added: boolean;
}

export const communitiesState = $state({
  entries: [] as CatalogEntry[],
  /** Текст поиска по каталогу. Фильтр клиентский: каталог приходит целиком. */
  query: '',
  isLoading: false,
  loaded: false,
  /** Сообщество, открытое для превью. */
  selected: null as CatalogEntry | null,
  /** Идёт просмотр или вступление. */
  isBusy: false,
  /** Ошибка последнего действия — показывается в превью. */
  error: '',
  /** Результат проверки прав на вступление. */
  eligibility: null as null | {
    checked: boolean;
    satisfied: boolean;
    addresses: string[];
    networksNotSupported: boolean;
  },
  /** Кошельковые адреса профиля (для выбора раскрываемых). */
  walletAddresses: [] as string[],
});

/** Приводит `Community` из status-go к записи каталога. */
function toEntry(community: Community, featured: boolean): CatalogEntry {
  return {
    id: community.id,
    name: community.name || community.id.slice(0, 10),
    description: community.description || '',
    access: communityAccess(community),
    featured,
    loaded: true,
    joined: community.joined === true,
    spectated: community.spectated === true,
    activeMembersCount: community.activeMembersCount,
    community,
  };
}

/**
 * Загружает каталог и объединяет его с локально известными сообществами.
 *
 * Два источника, потому что каждый неполон в одиночку:
 *   * каталог — ограничен записями контракта Directory, зато с `featured`;
 *   * `wakuext_communities` — всё, что известно локально, включая
 *     вступленные и просмотренные, которых может не быть в контракте.
 */
export async function loadCommunities(force = false): Promise<void> {
  if (!statusState.backendPort) return;
  if (communitiesState.loaded && !force) return;

  const port = statusState.backendPort;
  communitiesState.isLoading = true;
  try {
    const [curated, known] = await Promise.all([
      getCuratedCommunities(port).catch((e) => {
        warn('[communities] curated failed:', e);
        return {
          ids: [] as string[],
          featured: [] as string[],
          descriptions: {} as Record<string, Community>,
          unknown: [] as string[],
        };
      }),
      getCommunities(port).catch((e) => {
        warn('[communities] communities failed:', e);
        return [] as Community[];
      }),
    ]);

    info(
      `[communities] curated ids=${curated.ids.length} ` +
        `described=${Object.keys(curated.descriptions).length} ` +
        `unknown=${curated.unknown.length} known=${known.length}`
    );

    // Обычные Set/Map, а не Svelte-версии: это локальные переменные внутри
    // одной функции, к моменту чтения UI они уже не существуют. Реактивность
    // нужна итоговому `communitiesState.entries`, а не промежуточным вставкам.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- локальный кэш на время вызова
    const featured = new Set(curated.featured);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- локальный кэш на время вызова
    const byId = new Map<string, CatalogEntry>();

    // 1. Локально известные: у них есть описание и состояние участия.
    for (const community of known) {
      const entry = toEntry(community, featured.has(community.id));
      byId.set(community.id, entry);
    }

    // 2. Каталог: дополняет и добавляет то, чего локально нет.
    for (const id of curated.ids) {
      const described = curated.descriptions[id];
      if (described) {
        const entry = toEntry(described, featured.has(id));
        // Локальная запись точнее по `joined`/`spectated`: она пришла из базы.
        const local = byId.get(id);
        byId.set(id, local ? { ...entry, joined: local.joined, spectated: local.spectated } : entry);
      } else if (!byId.has(id)) {
        byId.set(id, {
          id,
          name: '',
          description: '',
          access: 'unknown',
          featured: featured.has(id),
          loaded: false,
          joined: false,
          spectated: false,
        });
      }
    }

    communitiesState.entries = [...byId.values()].sort((a, b) => {
      // Избранное вперёд, затем названия: так SIM показывает Discover.
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });

    communitiesState.loaded = true;
  } catch (e) {
    warn('[communities] load failed:', e);
  } finally {
    communitiesState.isLoading = false;
  }
}

/**
 * Локальная карта вместо `SvelteMap`.
 *
 * Список строится целиком внутри одной функции и сразу присваивается
 * состоянию, поэтому реактивность на промежуточные вставки не нужна —
 * хватает обычной `Map`.
 */

/** Записи каталога, подходящие под поиск. */
export function filteredEntries(): CatalogEntry[] {
  const q = communitiesState.query.trim().toLowerCase();
  if (!q) return communitiesState.entries;
  return communitiesState.entries.filter(
    (e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)
  );
}

/**
 * Дерево каналов выбранного сообщества: категории и каналы внутри них.
 *
 * ## Зачем дерево, а не плоский список
 *
 * Сообщество устроено как каталог: категории (`#general`, `#news`) — это
 * группы, а каналы лежат в них и упорядочены `position`. Плоский список
 * терял эту структуру, и по сообществу нельзя было понять, что где. В SIM
 * то же самое выглядит папками.
 *
 * ## Что попадает в дерево
 *
 * Все каналы, которые бэкенд вообще отдал в описании, включая те, что мы
 * читать не можем (`canView: false`): для превью это полезно — видно, что
 * внутри есть закрытые каналы. `added` отмечает те, что уже в списке чатов,
 * чтобы повторный клик не создавал путаницу.
 */
export function channelTree(community: Community | null | undefined): ChannelGroup[] {
  if (!community?.chats) return [];

  const chats = Object.entries(community.chats) as [string, CommunityChat][];
  const categories = community.categories || {};

  // Порядок категорий по `position`, прочие — в конце по имени.
  const cats = Object.entries(categories)
    // `id` берём из ключа карты: у самой категории поле `id` может быть
    // пустым, а ссылки на неё (`chat.categoryID`) — это ключи.
    .map(([id, cat]) => ({ ...cat, id }))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Ключ карты — это и есть id канала: `Community.chats` в status-go
  // отдаётся как map, а `chat.id` внутри может быть пустым. Поэтому берём
  // ключ, а не поле.
  const node = (channelId: string, chat: CommunityChat): CommunityChatNode => ({
    id: channelId,
    name: chat.name,
    canView: chat.canView !== false,
    canPost: chat.canPost === true,
    tokenGated: chat.tokenGated === true,
    added: false,
  });

  const byCategory = new Map<string, CommunityChatNode[]>();
  const uncategorized: CommunityChatNode[] = [];

  const sorted = chats.sort(
    (a, b) => (a[1].position ?? 0) - (b[1].position ?? 0)
  );

  for (const [channelId, chat] of sorted) {
    if (chat.categoryID && categories[chat.categoryID]) {
      const bucket = byCategory.get(chat.categoryID);
      if (bucket) bucket.push(node(channelId, chat));
      else byCategory.set(chat.categoryID, [node(channelId, chat)]);
    } else {
      uncategorized.push(node(channelId, chat));
    }
  }

  const groups: ChannelGroup[] = [];
  if (uncategorized.length) {
    groups.push({ id: '', name: 'Channels', channels: uncategorized });
  }
  for (const cat of cats) {
    const items = byCategory.get(cat.id);
    if (items?.length) groups.push({ id: cat.id, name: cat.name, channels: items });
  }
  return groups;
}

/**
 * Открывает канал сообщества и добавляет его в список чатов.
 *
 * ## Почему через спектацию, а не через вступление
 *
 * Канал внутри сообщества читается, как только сообщество просматривается
 * (`spectateCommunity`) — именно так SIM показывает `#intros` до вступления.
 * Добавление канала в список чатов — это `Chat`-запись, которую создаёт
 * `initCommunityChats` при спектации. Писать в канал без участия нельзя, но
 * читать можно, а вступление — отдельное решение пользователя (оно требует
 * адресов и пароля).
 *
 * ## Почему клик отмечает канал
 *
 * Левая панель показывает только каналы, которые пользователь добавил сам
 * (`chatSubscriptions`): просмотр сообщества создаёт `Chat`-записи для всех
 * его каналов, и список превращался в список сообществ. Клик по каналу в
 * каталоге — и есть «добавь мне этот канал».
 *
 * Возвращает id чата для выбора в списке и переключения раздела — само
 * переключение делает вызывающий код, потому что активная секция живёт в
 * `+page.svelte`, а не здесь.
 */
export async function openChannel(
  entry: CatalogEntry,
  channelId: string
): Promise<{ ok: boolean; chatId?: string; error?: string }> {
  if (!statusState.backendPort) return { ok: false, error: 'Backend is not running' };

  const port = statusState.backendPort;
  communitiesState.isBusy = true;
  communitiesState.error = '';
  try {
    // Идемпотентно: для уже просматриваемого сообщества status-go ответит
    // ошибкой «already spectated», и это не повод прекращать. Состояние
    // (`spectated`/`joined`) у записи могло устареть — например, после
    // перезапуска ноды, — поэтому зовём всегда и ошибку проглатываем.
    if (!entry.joined) {
      await spectateCommunity(port, entry.id).catch((e) => {
        debug(`[communities] spectate ${entry.id} skipped:`, e);
      });
    }

    const chatId = communityChatId(entry.id, channelId);

    // Отметка ДО загрузки списка: `buildItems` фильтрует по ней, и без
    // неё только что добавленный канал не попал бы в результат.
    subscribeChannel(chatId);

    // `loadChats(true)`: каналы появляются только после инициализации фильтров
    // и создания `Chat`-записей, а это делает бэкенд во время спектации.
    await loadChats(true);

    const found = chatsState.items.some((c) => c.id === chatId);
    if (!found) {
      // Канала нет в списке — это не ошибка вступления, но и открыть нечего.
      // Отметку снимаем: иначе канал считался бы добавленным, но не
      // появлялся бы нигде, и это выглядело бы как поломка.
      unsubscribeChannel(chatId);
      return { ok: false, error: 'Channel is not readable' };
    }

    info(`[communities] opened channel ${chatId}`);
    return { ok: true, chatId };
  } catch (e) {
    const error = formatError(e);
    communitiesState.error = error;
    return { ok: false, error };
  } finally {
    communitiesState.isBusy = false;
  }
}

/**
 * Открывает превью сообщества.
 *
 * Просмотр (`spectateCommunity`) выполняется сразу: именно он делает каналы
 * читаемыми до вступления — так ведёт себя SIM. Это действие необратимо
 * только в смысле записи в базу status-go, поэтому из превью его можно
 * снять.
 */
export async function selectCommunity(entry: CatalogEntry): Promise<void> {
  communitiesState.selected = entry;
  communitiesState.error = '';
  communitiesState.eligibility = null;

  if (!statusState.backendPort) return;

  // Уже участник или уже смотрим — повторный spectate вернёт ошибку
  // «already spectated or joined», нечего и вызывать.
  if (entry.joined || entry.spectated) return;

  communitiesState.isBusy = true;
  try {
    // Ждём ответ: у записи из `unknownCommunities` описания в базе нет, и без
    // ожидания status-go только запустит фоновую догрузку, а нам вернёт
    // пустоту. Пользователь в этот момент уже смотрит на дерево каталога,
    // поэтому явное ожидание одного сообщества правильнее «вечной загрузки».
    const fresh = await fetchCommunity(statusState.backendPort, entry.id, !entry.joined);
    if (fresh) {
      const updated = toEntry(fresh, entry.featured);
      communitiesState.selected = updated;
      const idx = communitiesState.entries.findIndex((e) => e.id === entry.id);
      if (idx >= 0) communitiesState.entries[idx] = updated;
      debug(`[communities] spectating ${entry.id}`);
    } else {
      warn(`[communities] no description for ${entry.id}`);
    }
  } catch (e) {
    // Просмотр не критичен: сообщество всё равно остаётся открытым в
    // превью, просто каналы могут не читаться.
    warn('[communities] spectate failed:', e);
  } finally {
    communitiesState.isBusy = false;
  }
}

/** Кошельковые адреса профиля — кандидаты на раскрытие. */
export async function loadWalletAddresses(): Promise<string[]> {
  if (!statusState.backendPort) return [];
  if (communitiesState.walletAddresses.length) return communitiesState.walletAddresses;

  try {
    const accounts = await getAccounts(statusState.backendPort);
    const addresses = accounts
      .filter((a: any) => a && a.address && !a.chat)
      .map((a: any) => String(a.address));
    communitiesState.walletAddresses = addresses;
    return addresses;
  } catch (e) {
    warn('[communities] accounts failed:', e);
    return [];
  }
}

/**
 * Проверяет, проходят ли наши адреса по условиям сообщества.
 *
 * Вызывается при открытии превью токен-гейтед сообщества и отдаёт ответ на
 * «You are eligible to join as member».
 */
export async function checkEligibility(): Promise<void> {
  const entry = communitiesState.selected;
  if (!entry || !statusState.backendPort) return;

  communitiesState.isBusy = true;
  communitiesState.error = '';
  try {
    const addresses = await loadWalletAddresses();
    const res = await checkPermissionsToJoinCommunity(
      statusState.backendPort,
      entry.id,
      addresses
    );
    communitiesState.eligibility = {
      checked: true,
      satisfied: res.satisfied,
      addresses: res.validCombinations.map((c) => c.address),
      networksNotSupported: res.networksNotSupported,
    };
    info(
      `[communities] eligibility ${entry.id}: satisfied=${res.satisfied} ` +
        `addresses=${res.validCombinations.length}`
    );
  } catch (e) {
    communitiesState.error = formatError(e);
  } finally {
    communitiesState.isBusy = false;
  }
}

/**
 * Вступает в сообщество: подпись адресов и отправка заявки.
 *
 * ## Три шага, и пароль посередине
 *
 * `RequestToJoinCommunity` в status-go требует непустой список адресов,
 * `airdropAddress` внутри него и подписи на каждый адрес. Подписывает тоже
 * status-go, но проверяя пароль (`GetVerifiedWalletAccount`). Поэтому
 * вступление нельзя сделать одной кнопкой — нужен выбор адресов и пароль.
 *
 * ## Почему результат всегда «заявка»
 *
 * Даже для открытого сообщества (`AUTO_ACCEPT`) принятие приходит не в
 * ответе на вызов, а потом — сигналом. Обещать «вступил» сразу значило бы
 * показать пустой список каналов и соврать о причине.
 */
export async function joinSelectedCommunity(
  addressesToReveal: string[],
  airdropAddress: string,
  password: string
): Promise<{ ok: boolean; pending?: boolean; error?: string }> {
  const entry = communitiesState.selected;
  if (!entry || !statusState.backendPort) {
    return { ok: false, error: 'No community selected' };
  }
  if (!addressesToReveal.length) return { ok: false, error: 'Select at least one address' };
  if (!airdropAddress) return { ok: false, error: 'Select an airdrop address' };

  const port = statusState.backendPort;
  communitiesState.isBusy = true;
  communitiesState.error = '';
  try {
    const toSign = await generateJoiningRequestsForSigning(
      port,
      statusState.publicKey || '',
      entry.id,
      addressesToReveal
    );

    // Watch-only и chat-аккаунты подписать нельзя, поэтому ответ может быть
    // короче запрошенного списка. Порядок подписей в заявке обязан
    // совпадать с порядком адресов, поэтому фильтруем именно здесь.
    const signable = toSign.filter((p) => !!p.data);
    if (!signable.length) {
      throw new Error('No address can be revealed: watch-only accounts cannot sign');
    }

    const signatures = await signJoinRequestData(port, signable, password);
    if (signatures.length !== signable.length) {
      throw new Error('Signature count does not match address count');
    }

    const revealed = signable.map((p) => p.account);
    const airdrop = revealed.includes(airdropAddress) ? airdropAddress : revealed[0];

    await requestToJoinCommunity(port, entry.id, revealed, signatures, airdrop);
    info(`[communities] join requested ${entry.id} addresses=${revealed.length}`);

    return { ok: true, pending: true };
  } catch (e) {
    const error = formatError(e);
    communitiesState.error = error;
    return { ok: false, error };
  } finally {
    communitiesState.isBusy = false;
  }
}

/** Убирает просмотренное сообщество (`leaveCommunity` очищает оба флага). */
export function resetCommunities() {
  communitiesState.entries = [];
  communitiesState.query = '';
  communitiesState.loaded = false;
  communitiesState.isLoading = false;
  communitiesState.selected = null;
  communitiesState.isBusy = false;
  communitiesState.error = '';
  communitiesState.eligibility = null;
  communitiesState.walletAddresses = [];
}
