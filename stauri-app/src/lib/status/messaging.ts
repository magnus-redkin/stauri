/**
 * Граница status-go для мессенджинга (шаг 15 плана, вариант A).
 *
 * ## Зачем отдельный модуль
 *
 * Общая цель Stauri — брать из status-go только сеть и кошелёк, а всё
 * остальное выносить. Мессенджинг пока остаётся на статусе, но мы зафиксировали
 * границу: все методы `wakuext_*`, связанные с чатами и сообществами, живут
 * здесь и нигде больше.
 *
 * Когда status-go уйдёт (см. docs/ru/providers_and_dapps.md и план перехода на
 * Logos), менять придётся этот файл и его вызовы, а не весь фронтенд.
 *
 * ## Формы ответов
 *
 * Все методы ходят через `statusFetch` и возвращают `result` из JSON-RPC.
 * Поля описаны в `types.ts`: `Chat` использует `chatType`, `communityId`,
 * `categoryId`; `Community` вложенными `chats` и `categories`.
 *
 * `chatType` — число (см. `ChatType` ниже), а не строка. Это важно: фильтрация
 * по строке молча не находит ничего.
 */

import { invoke } from '@tauri-apps/api/core';
import { statusFetch } from './http';
import { debug } from '$lib/utils/log';
import type {
  Chat,
  Community,
  CommunityAccess,
  CommunityChat,
  CommunityPermissions,
  CommunityTokenPermission,
} from './types';

/**
 * Типы чатов status-go (internal/protocol/chat.go).
 *
 * Значения фиксированы и меняются только вместе со status-go: `iota + 1`,
 * поэтому нельзя переставлять.
 */
export const ChatType = {
  OneToOne: 1,
  Public: 2,
  PrivateGroup: 3,
  Profile: 4, // deprecated
  Timeline: 5, // deprecated
  Community: 6,
} as const;

export type ChatTypeValue = (typeof ChatType)[keyof typeof ChatType];

/** Является ли чат каналом (публичный чат-канал). */
export function isChannel(chat: Chat): boolean {
  return chat.chatType === ChatType.Public;
}

/** Является ли чат частью сообщества. */
export function isCommunityChat(chat: Chat): boolean {
  return chat.chatType === ChatType.Community || !!chat.communityId;
}

/** Личная переписка. */
export function isDirectMessage(chat: Chat): boolean {
  return chat.chatType === ChatType.OneToOne;
}

// ===========================================================================
// ЧТЕНИЕ
// ===========================================================================

/**
 * Список чатов.
 *
 * ## Почему `chats`, а не `chatsPreview`
 *
 * `chatsPreview` в этой ветке status-go фильтрует **наоборот**: берёт только
 * чаты с `chat.Active || chat.Muted`
 * (internal/protocol/messenger_chats.go, `ChatsPreview`). То есть нормально
 * вступлённый канал (`Active = true`, не замьючен) в его выдачу не попадает
 * никогда — именно поэтому канал «не появлялся» после вступления.
 *
 * `Chats()` возвращает все чаты без этого фильтра и включает поле `Active`,
 * по которому мы сами решаем, что показывать.
 *
 * Цена — полные записи вместо облегчённых (с участниками и т. п.). Для списка
 * это лишние килобайты, но корректность важнее.
 */
export async function getChats(port: number): Promise<Chat[]> {
  const res = await statusFetch<{ result?: Chat[] }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_chats',
    params: [],
  });
  return res.result || [];
}

/**
 * Облегчённые превью чатов.
 *
 * Оставлено для случаев, где нужен только список без участников. Для списка
 * чатов не использовать: см. `getChats`.
 */
export async function getChatPreviews(
  port: number,
  filter?: 'community' | 'nonCommunity'
): Promise<any[]> {
  const params: any[] = [];
  if (filter === 'community') params.push(0); // ChatPreviewFilterTypeCommunity
  else if (filter === 'nonCommunity') params.push(1); // ChatPreviewFilterTypeNonCommunity

  const res = await statusFetch<{ result?: any[] }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_chatsPreview',
    params,
  });
  return res.result || [];
}

/** Полная запись чата по id. Нужна, когда списка недостаточно. */
export async function getChat(port: number, chatId: string): Promise<Chat | null> {
  const res = await statusFetch<{ result?: Chat | null }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_chat',
    params: [chatId],
  });
  return res.result ?? null;
}

/**
 * Сообщения чата.
 *
 * `cursor` — для постраничной загрузки; пустая строка означает «с последних».
 * Возвращаемое значение содержит `messages` и `cursor` для следующей страницы.
 */
export async function getChatMessages(
  port: number,
  chatId: string,
  limit = 20,
  cursor = ''
): Promise<{ messages: any[]; cursor?: string }> {
  const res = await statusFetch<{ result?: { messages?: any[]; cursor?: string } }>(
    port,
    'CallRPC',
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'wakuext_chatMessages',
      params: [chatId, cursor, limit],
    }
  );
  return { messages: res.result?.messages || [], cursor: res.result?.cursor };
}

// ===========================================================================
// СООБЩЕСТВА
// ===========================================================================

/**
 * Сообщества, в которых состоит пользователь.
 *
 * Внутри каждого — `chats` (id канала -> запись канала) и `categories`
 * (id категории -> категория) со всеми подписями.
 */
export async function getJoinedCommunities(port: number): Promise<Community[]> {
  const res = await statusFetch<{ result?: Community[] }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_joinedCommunities',
    params: [],
  });
  return res.result || [];
}

/** Все известные сообщества, включая невступлённые. */
export async function getCommunities(port: number): Promise<Community[]> {
  const res = await statusFetch<{ result?: Community[] }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_communities',
    params: [],
  });
  return res.result || [];
}

/**
 * Просматриваемые сообщества (spectate).
 *
 * ## Зачем отдельный метод
 *
 * `wakuext_joinedCommunities` — это буквально `WHERE c.joined`
 * (internal/protocol/communities/persistence.go, `JoinedCommunities`).
 * Просматриваемые сообщества туда не попадают, хотя их каналы лежат в
 * `wakuext_chats` и читаются.
 *
 * Отдельного RPC «joined or spectated» нет: `JoinedOrSpectatedCommunities`
 * существует в `Persistence`, но не выставлен в `PublicAPI`. Поэтому
 * берём `wakuext_communities` (`All()`) и фильтруем на клиенте.
 */
export async function getSpectatedCommunities(port: number): Promise<Community[]> {
  const all = await getCommunities(port);
  return all.filter((c) => c.spectated === true);
}

/**
 * Каталог сообществ из смарт-контракта Directory.
 *
 * Это источник раздела Discover в SIM (`messenger_curated_communities.go`,
 * `getCuratedCommunitiesFromContract`): Optimism mainnet, или Optimism
 * Sepolia при включённом тестовом режиме.
 *
 * Ответ устроен не как «список готовых сообществ»:
 *   * `communities` — карта id -> описание, но ТОЛЬКО для тех, чьё описание
 *     уже лежит в базе;
 *   * `unknownCommunities` — id из контракта, описания которых ещё нет;
 *     status-go догружает их фоном и присылает сигнал.
 *
 * Поэтому на первом вызове карта может быть пустой — это не ошибка.
 */
export async function getCuratedCommunities(
  port: number
): Promise<{
  ids: string[];
  featured: string[];
  descriptions: Record<string, Community>;
  unknown: string[];
}> {
  const res = await statusFetch<{
    result?: {
      contractCommunities?: string[];
      contractFeaturedCommunities?: string[];
      communities?: Record<string, Community>;
      unknownCommunities?: string[];
    };
  }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_curatedCommunities',
    params: [],
  });

  const r = res.result;
  return {
    ids: r?.contractCommunities || [],
    featured: r?.contractFeaturedCommunities || [],
    descriptions: r?.communities || {},
    unknown: r?.unknownCommunities || [],
  };
}

// ===========================================================================
// ДОСТУП И ВСТУПЛЕНИЕ
// ===========================================================================

/** Значения `CommunityPermissions_Access` (protobuf/communities.pb.go). */
export const CommunityAccessValue = {
  Unknown: 0,
  AutoAccept: 1,
  /** @deprecated в самом .proto; не используется с 2022 года. */
  InvitationOnly: 2,
  ManualAccept: 3,
} as const;

/** `CommunityTokenPermission_Type`. */
export const TokenPermissionType = {
  Unknown: 0,
  BecomeAdmin: 1,
  BecomeMember: 2,
  CanViewChannel: 3,
  CanViewAndPostChannel: 4,
  BecomeTokenMaster: 5,
  BecomeTokenOwner: 6,
} as const;

/**
 * Как сообщество пускает внутрь — одним значением.
 *
 * ## Почему не по `canRequestAccess`
 *
 * `CanRequestAccess` в status-go возвращает `false` и когда сообщество
 * открытое, и когда мы уже участники:
 *
 * ```go
 * func (o *Community) CanRequestAccess(pk *ecdsa.PublicKey) bool {
 *     if o.hasMember(pk) { return false }
 *     return o.config.CommunityDescription.Permissions.Access == MANUAL_ACCEPT
 * }
 * ```
 *
 * Отличить «открытое» от «уже внутри» по нему невозможно, а нам нужно
 * различие именно для экрана превью, где пользователь ещё не участник.
 *
 * ## Почему токен-гейт первым
 *
 * `Encrypted()` в status-go определяется как «есть право BECOME_MEMBER»,
 * независимо от `access`. Сообщество может одновременно быть MANUAL_ACCEPT
 * и требовать токен — тогда вступление это «заявка + проверка токена», и
 * пользователю важнее знать про токен.
 */
export function communityAccess(community: {
  permissions?: CommunityPermissions;
  tokenPermissions?: Record<string, CommunityTokenPermission>;
}): CommunityAccess {
  const tokenGated = Object.values(community.tokenPermissions || {}).some(
    (p) => p?.type === TokenPermissionType.BecomeMember
  );
  if (tokenGated) return 'token';

  switch (community.permissions?.access) {
    case CommunityAccessValue.AutoAccept:
      return 'open';
    case CommunityAccessValue.ManualAccept:
      return 'request';
    default:
      // UNKNOWN_ACCESS или поле не пришло. В status-go «всегда нужно
      // просить доступ» — поведение по умолчанию (validateRequestToJoin…),
      // поэтому осторожная трактовка — `request`, а не `open`.
      return 'unknown';
  }
}

/**
 * Полный id канала внутри сообщества.
 *
 * id канала в `Community.chats` — голое имя (`intros`), а `Chat.id` —
 * склейка `communityID + channelID` (internal/protocol/communities,
 * `ChatID`). Для `sendChatMessage` нужен именно склеенный: иначе сообщение
 * уйдёт в несуществующий чат.
 */
export function communityChatId(communityId: string, channelId: string): string {
  return `${communityId}${channelId}`;
}

/**
 * Проверка, какие наши адреса проходят по токен-условиям сообщества.
 *
 * `satisfied` — ответ на «You are eligible to join as member».
 * `validCombinations` — какие адреса подошли (и для каких сетей), то есть
 * содержимое экрана «Select address to share».
 *
 * Вызов без `addresses` проверяет все активные кошельковые адреса.
 */
export async function checkPermissionsToJoinCommunity(
  port: number,
  communityId: string,
  addresses: string[] = []
): Promise<{
  satisfied: boolean;
  validCombinations: Array<{ address: string; chainIds: number[] }>;
  networksNotSupported: boolean;
  roles?: any[];
  highestRole?: any;
}> {
  const res = await statusFetch<{
    result?: {
      satisfied?: boolean;
      validCombinations?: Array<{ address: string; chainIds: number[] }>;
      networksNotSupported?: boolean;
      roles?: any[];
      highestRole?: any;
    };
  }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_checkPermissionsToJoinCommunity',
    params: [{ communityId: normalizeHex(communityId), addresses }],
  });

  const r = res.result;
  return {
    satisfied: r?.satisfied ?? false,
    validCombinations: r?.validCombinations || [],
    networksNotSupported: r?.networksNotSupported ?? false,
    roles: r?.roles,
    highestRole: r?.highestRole,
  };
}

/**
 * Получает данные, которые нужно подписать, чтобы раскрыть адреса.
 *
 * Возвращает по одному `SignParams` на адрес; порядок соответствует
 * порядку `addressesToReveal`. Подписывается
 * `keccak256(publicKeyCompressed, communityID, requestID)` — то есть подпись
 * привязана и к сообществу, и к конкретной заявке, и переиспользовать её
 * для другого сообщества нельзя.
 */
export async function generateJoiningRequestsForSigning(
  port: number,
  memberPublicKey: string,
  communityId: string,
  addressesToReveal: string[]
): Promise<Array<{ data: string; account: string }>> {
  const res = await statusFetch<{
    result?: Array<{ data: string; account: string }>;
  }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_generateJoiningCommunityRequestsForSigning',
    params: [memberPublicKey, normalizeHex(communityId), addressesToReveal],
  });
  return res.result || [];
}

/**
 * Подписывает подготовленные хеши.
 *
 * ## Почему это отдельный и неизбежный шаг
 *
 * Внутри `Messenger.SignData` вызывается
 * `m.accountsManager.GetVerifiedWalletAccount(address, param.Password)` —
 * то есть status-go проверяет пароль пользователя на каждом адресе. Без
 * пароля подписи не будет, а без подписей `RequestToJoinCommunity` откажет
 * (в заявке допускается пустой `signatures`, но control node отбрасывает
 * такие заявки как неподтверждённые).
 *
 * Отдельный `signData` выносит ввод пароля в интерфейс: у нас нет
 * keystore, который мог бы подписать молча.
 *
 * `password` один на все адреса: ключи одного профиля открываются одним
 * паролем. Если понадобится раздельное подписание — это отдельный вызов
 * на каждый адрес.
 */
export async function signJoinRequestData(
  port: number,
  params: Array<{ data: string; account: string }>,
  password: string
): Promise<string[]> {
  const res = await statusFetch<{ result?: string[] }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_signData',
    params: [params.map((p) => ({ ...p, password }))],
  });
  return res.result || [];
}

/**
 * Отправляет заявку на вступление.
 *
 * Требования status-go, которые проверяются до отправки
 * (requests/request_to_join_community.go, `Validate`):
 *   * `addressesToReveal` не пуст;
 *   * `airdropAddress` задан и входит в `addressesToReveal`;
 *   * длина каждой подписи ровно `crypto.SignatureLength` (65).
 *
 * `shareFutureAddresses` — подписываться ли новыми адресами, добавленными
 * в кошелёк позже. По умолчанию `false`: молча получив новый адрес, мы не
 * хотим автоматически раскрывать его сообществу.
 */
export async function requestToJoinCommunity(
  port: number,
  communityId: string,
  addressesToReveal: string[],
  signatures: string[],
  airdropAddress: string,
  shareFutureAddresses = false
): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_requestToJoinCommunity',
    params: [
      {
        communityId: normalizeHex(communityId),
        ensName: '',
        addressesToReveal,
        signatures,
        airdropAddress,
        shareFutureAddresses,
      },
    ],
  });
}

/**
 * Просмотр сообщества без вступления.
 *
 * Ставит `Spectated = true`, инициализирует фильтры (подписка на pubsub-топик
 * сообщества) и создаёт записи `Chat` для всех каналов. После этого каналы
 * читаются, но `CanView` для нас `false` — писать нельзя, интерфейс прячет
 * ввод.
 *
 * Работает только для НЕзашифрованных каналов: в токен-гейте содержимое
 * зашифровано ключом, который выдаётся при вступлении.
 *
 * Состояние сохраняется в базу, поэтому «просмотр» переживает перезапуск и
 * требует явного `leaveCommunity`, чтобы убрать.
 */
export async function spectateCommunity(port: number, communityId: string): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_spectateCommunity',
    params: [normalizeHex(communityId)],
  });
}

/**
 * Загружает сообщество по ключу (ссылка-приглашение или `0x`-идентификатор).
 *
 * `waitForResponse: false` по умолчанию — не блокируем вызов до получения
 * ответа из сети: интерфейс покажет «загрузка» и обновится по сигналу
 * `community.found`. С `true` вызов может висеть десятки секунд на медленной
 * сети, поэтому включать его нужно только там, где ждать действительно надо.
 *
 * ## Когда нужен `waitForResponse: true`
 *
 * Каталог (`wakuext_curatedCommunities`) отдаёт id из контракта и описания
 * только для тех сообществ, что уже лежат в базе. Остальные попадают в
 * `unknownCommunities`, и status-go догружает их ФОНОМ. Если фон не успел,
 * в каталоге остаются записи «Loading description…», и сигнал
 * `curated.communities.update` приходит только когда список в контракте
 * изменится — то есть обычно никогда.
 *
 * Поэтому при раскрытии такого сообщества пользователем ждём ответ явно:
 * это одно сообщество, а не весь каталог, и пользователь уже смотрит на
 * индикатор загрузки.
 */
export async function fetchCommunity(
  port: number,
  communityKey: string,
  waitForResponse = false
): Promise<Community | null> {
  const res = await statusFetch<{ result?: Community | null }>(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_fetchCommunity',
    params: [{ communityKey, tryDatabase: true, waitForResponse }],
  });
  return res.result ?? null;
}

/**
 * Вступает в сообщество.
 *
 * `communityID` — `cryptotypes.HexBytes` в status-go, то есть строка с
 * префиксом `0x` (см. internal/crypto/types/hex.go: `UnmarshalJSON` ждёт
 * именно строку). Передавать id без `0x` нельзя — разбор упадёт.
 */
export async function joinCommunity(port: number, communityId: string): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_joinCommunity',
    params: [normalizeHex(communityId)],
  });
}

/** Покидает сообщество. */
export async function leaveCommunity(port: number, communityId: string): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_leaveCommunity',
    params: [normalizeHex(communityId)],
  });
}

/**
 * Убирает чат из списка (`wakuext_deactivateChat`).
 *
 * Поле в запросе называется `id`, а не `chatID`: так объявлен
 * `requests.DeactivateChat` (internal/protocol/requests/deactivate_chat.go).
 * С `chatID` бэкенд отвечает «deactivate-chat: invalid id» — проверено.
 *
 * `preserveHistory: false` — история удаляется вместе с чатом. Для публичного
 * канала это единственный способ «отписаться»: он не имеет владельца и
 * удалить его для всех нельзя, но у себя убрать можно.
 *
 * Для канала сообщества этот вызов скрывает канал, а не сообщество. Чтобы
 * уйти из сообщества целиком, нужен `leaveCommunity`.
 */
export async function deactivateChat(
  port: number,
  chatId: string,
  preserveHistory = false
): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_deactivateChat',
    params: [{ id: chatId, preserveHistory }],
  });
}

/**
 * Вступает в публичный канал (или создаёт его, если такого ещё нет).
 *
 * В status-go за это отвечает `CreatePublicChat`, принимающий объект
 * `{ id }` (internal/protocol/requests/create_public_chat.go), а не строку.
 * `id` — имя канала без решётки, например `status`.
 */
export async function joinPublicChat(port: number, chatId: string): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_createPublicChat',
    params: [{ id: normalizeChatId(chatId) }],
  });
}

/**
 * Приводит идентификатор к виду с `0x`.
 *
 * status-go разбирает `HexBytes` только из строки с префиксом; без него
 * `UnmarshalJSON` вернёт ошибку разбора, и вступление не произойдёт.
 */
export function normalizeHex(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

/**
 * Приводит имя канала к виду, который ждёт status-go.
 *
 * Пользователь может вставить `#status`, `t.me/status` или просто `status` —
 * принимаем все варианты и оставляем имя без решётки и без домена.
 */
export function normalizeChatId(raw: string): string {
  let id = raw.trim();
  // Ссылка на канал: t.me/<name> или https://t.me/<name>
  const link = id.match(/^(?:https?:\/\/)?(?:www\.)?t\.me\/([^/?#]+)/i);
  if (link) id = link[1];
  id = id.replace(/^#/, '');
  return id.trim();
}

/**
 * Достаёт UUID канала из ссылки `status.app/cc/<uuid>#<ключ>`.
 *
 * Такая ссылка — это `Chat.DeepLink()` в status-go:
 *
 * ```go
 * func (c *Chat) DeepLink() string {
 *     if c.CommunityChat() {
 *         return "status-app://cc/" + communityChannelID + "#" + serializedCommunityID
 *     }
 * ```
 *
 * `communityChannelID` — UUID канала (в status-go `channelUUIDRegExp`:
 * `^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$`).
 * Возвращаем его, только если он действительно похож на UUID: по этому
 * значению мы ищем канал в `Community.chats`, и мусор там ничего не найдёт.
 *
 * Для ссылок других видов (`/c/…`, `/user/…`) не возвращаем ничего —
 * канала в них нет.
 *
 * ## Только для «голого» UUID
 *
 * Вторая форма канальной ссылки несёт brotli-сжатый protobuf вместо UUID.
 * Здесь её разобрать нельзя (в webview нет brotli), поэтому такие ссылки
 * идут через `parseInviteLink` — команду Rust (`src-tauri/src/invite.rs`).
 * Эта функция остаётся синхронной и без зависимостей: она для случая, когда
 * UUID пришёл как есть.
 */
export function channelIdFromInvite(raw: string): string | null {
  const m = raw.trim().match(/status\.app\/cc\/([^#?&\s]+)/i);
  if (!m) return null;

  let uuid: string;
  try {
    uuid = decodeURIComponent(m[1]).toLowerCase();
  } catch {
    // Битая процентная последовательность — не повод бросать исключение.
    return null;
  }
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  return re.test(uuid) ? uuid : null;
}

/**
 * Разбирает канальную ссылку через Rust — и для сжатого пейлоада тоже.
 *
 * ## Почему не во фронтенде
 *
 * Вторая форма ссылки (`status.app/cc/<brotli>#<ключ>`) содержит brotli-сжатый
 * protobuf с описанием канала и сообщества. `DecompressionStream` в Chromium
 * знает gzip и deflate, brotli в нём нет, поэтому разбор — в Rust.
 *
 * Разбор есть и в самом `status-go` (`sharedurls.Service`), но не выставлен
 * как RPC — форк для этого не нужен.
 *
 * Возвращает `null`, если ссылка не на канал. Ошибки разбора не бросает:
 * сообщество по ключу после `#` открывается в любом случае.
 */
export async function parseChannelInvite(
  raw: string
): Promise<{ channelId: string | null; channelName: string | null; communityName: string | null } | null> {
  if (!/status\.app\/cc\//i.test(raw)) return null;

  // Сначала пробуем дешёвый путь: UUID текстом, без Rust.
  const bare = channelIdFromInvite(raw);
  if (bare) return { channelId: bare, channelName: null, communityName: null };

  try {
    const parsed = await invoke<{
      channel_id: string | null;
      channel_name: string | null;
      community_name: string | null;
    } | null>('parse_invite_link', { url: raw });

    if (!parsed) return null;
    return {
      channelId: parsed.channel_id,
      channelName: parsed.channel_name,
      communityName: parsed.community_name,
    };
  } catch (e) {
    // Разбор описания — вспомогательный: без него сообщество всё равно
    // откроется, просто на первом канале.
    debug('[invite] failed to parse channel link:', e);
    return null;
  }
}

/**
 * Достаёт id сообщества из ссылки-приглашения Status.
 *
 * ## Почему нельзя просто взять хвост после `/c/`
 *
 * Ссылка имеет вид:
 *
 * ```
 * https://status.app/c/G0UAAGR0254s...==#zQ3shuaXi1bQ6iVowkgm6eUtt5PPToUUpifePDvereeupioks
 *                          └─ base64 ─┘  └─ base58btc, ключ сообщества ─┘
 * ```
 *
 * `FetchCommunityRequest.Validate` требует hex:
 *
 * ```go
 * if _, err := cryptotypes.DecodeHex(r.CommunityKey); err != nil {
 *     return fmt.Errorf("invalid community key")
 * }
 * ```
 *
 * Значит base64-часть не подходит, а хвост после `#` — это multibase base58btc:
 * первый символ `z` означает base58, дальше идёт varint-префикс multicodec
 * `0xe7 0x01` (`secp256k1-pub`, два байта) и сжатый публичный ключ (33 байта).
 * Итоговый id — `0x` + hex этих 33 байт.
 *
 * ## Что делаем с ключом, если декодировать не удалось
 *
 * Возвращаем строку как есть: бэкенд ответит внятной ошибкой, а мы не
 * теряем возможность передать уже hex-идентификатор.
 */
export function communityIdFromInvite(raw: string): string {
  const value = raw.trim();

  // Ключ после `#` — основной вариант для ссылки-приглашения.
  const hashIdx = value.lastIndexOf('#');
  const candidate = hashIdx >= 0 ? value.slice(hashIdx + 1).trim() : value;

  if (/^0x[0-9a-fA-F]{64,}$/.test(candidate)) return candidate;
  if (candidate.startsWith('z')) {
    const decoded = base58ToHex(candidate);
    if (decoded) return decoded;
  }
  return candidate;
}

/**
 * multibase-base58btc → `0x`-hex сжатого публичного ключа.
 *
 * Снимает ровно два байта varint-префикса multicodec. Длина префикса
 * фиксирована для `secp256k1-pub` (0xe7 0x01), поэтому разбор не нужен:
 * после него должно остаться 33 байта.
 */
function base58ToHex(s: string): string | null {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;
  for (const ch of s.slice(1)) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  if (num === 0n) return null;

  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes = hex.length / 2;

  // 35 байт = 2 байта multicodec + 33 байта ключа. Если пришло больше —
  // значит префикс длиннее, и отрезать наугад нельзя.
  const prefixLen = bytes - 33;
  if (prefixLen < 1 || prefixLen > 2) return null;

  return '0x' + hex.slice(prefixLen * 2);
}

/**
 * Разворачивает сообщества в плоский список каналов.
 *
 * Нужно для списка чатов: пользователю важны каналы, а не вложенность.
 * Каждый элемент несёт `communityId` и `categoryId`, чтобы UI мог собрать
 * заголовки групп.
 *
 * ## Почему id пересобирается
 *
 * В `Community.chats` ключ и поле `id` — это ГОЛОЕ имя канала (`intros`),
 * а `Chat.id` в status-go — склейка `communityID + channelID`
 * (internal/protocol/communities/community.go, `ChatID`). Совпадать они
 * обязаны: по `id` мы ищем чат в результатах `wakuext_chats`, а в
 * `sendChatMessage` передаём его как `chatId`. Оставь мы голое имя, и
 * сообщение ушло бы в несуществующий чат, а канал продублировался бы в
 * списке отдельной строкой.
 */
export function communityChannels(communities: Community[]): CommunityChat[] {
  const out: CommunityChat[] = [];
  for (const community of communities) {
    const chats = community.chats || {};
    for (const [channelId, chat] of Object.entries(chats)) {
      out.push({
        ...chat,
        id: communityChatId(community.id, channelId),
        communityId: community.id,
        communityName: community.name,
      });
    }
  }
  return out;
}

// ===========================================================================
// ОТПРАВКА
// ===========================================================================

/**
 * Отправка текстового сообщения.
 *
 * `wakuext_sendChatMessage` принимает `*common.Message`, а не готовые строки.
 * Тело повторяет форму, которую разбирает `Message.UnmarshalJSON` в
 * status-go (см. internal/protocol/common/message.go): `id` и `chatId` лежат
 * на верхнем уровне (на стороне Go это встроенный `protobuf.ChatMessage`),
 * `contentType: 1` — обычный текст.
 *
 * Порядок аргументов `params` — один элемент-объект; отдельные `chatId` и
 * `text` метод НЕ принимает, хотя именно так выглядела прежняя версия.
 *
 * `communityId` нужен для сообщений в каналах сообществ; для личных чатов и
 * публичных каналов — пустая строка.
 *
 * `responseTo` превращает сообщение в комментарий (см. docs/ru/akk_scheme.md).
 * Пустая строка — обычное сообщение. Ограничения и следствия:
 *
 *   * поле работает без feature-флага, в отличие от `threadId`, который при
 *     выключенном `featureFlags.Threads` бэкенд молча затирает
 *     (messenger.go, `message.ThreadId = nil`);
 *   * бэкенд принимает только id сообщения, которое у него уже есть в базе
 *     (`MessagesExist`, `SELECT id FROM user_messages WHERE id IN (...)` без
 *     фильтра по чату);
 *   * ответ остаётся обычной строкой с тем же `local_chat_id`, поэтому
 *     приходит в общем списке канала — разделять записи и комментарии
 *     обязан клиент, см. `isReply`.
 */
export async function sendChatMessage(
  port: number,
  chatId: string,
  text: string,
  communityId = '',
  responseTo = ''
): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 3,
    method: 'wakuext_sendChatMessage',
    params: [
      {
        id: '',
        chatId,
        text,
        contentType: 1,
        communityId,
        responseTo,
      },
    ],
  });
}

/**
 * Является ли сообщение комментарием.
 *
 * status-go не различает записи и ответы на уровне канала: комментарий лежит
 * в той же таблице `user_messages` с тем же `local_chat_id`, а
 * `MessageByChatID` фильтрует `response_to` только через `thread_id`, и тот
 * фильтр отключён при выключенных threads:
 *
 * > If threads are disabled, then we are backwards compatible and messages in
 * > threads are treated as normal messages, so we don't filter them out.
 *
 * Значит разделение — наша обязанность, и жить оно должно в одном месте:
 * иначе лента канала и панель комментариев разойдутся в трактовке.
 */
export function isReply(msg: { responseTo?: string } | null | undefined): boolean {
  return !!msg?.responseTo && msg.responseTo.length > 0;
}

// ===========================================================================
// КОНТАКТЫ
// ===========================================================================

// Контакты оставлены здесь же: они часть того же пространства имён и
// используются списком чатов для подстановки имён.
export async function getContacts(port: number): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_contacts',
    params: [],
  });
}

export async function acceptContactRequest(port: number, contactPublicKey: string): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_acceptLatestContactRequestForContact',
    params: [{ id: contactPublicKey }],
  });
}

export async function sendContactRequest(
  port: number,
  publicKey: string,
  message = ''
): Promise<any> {
  return await statusFetch(port, 'CallRPC', {
    jsonrpc: '2.0',
    id: 1,
    method: 'wakuext_sendContactRequest',
    params: [{ id: publicKey, message }],
  });
}
