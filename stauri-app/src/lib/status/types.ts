export interface StartBackendResponse {
  /** Настоящий порт status-backend. Внутренний, фронтенд его не использует. */
  port: number;
  /** Порт аутентифицирующего прокси — через него идёт весь трафик. */
  authPort: number;
  dataDir: string;
  networkName: string;
  chainId: number;
  rpcUrl: string;
  wakuFleet: string;
  isTestnet: boolean;
}

export interface InitializeResponse {
  accounts: any[] | null;
}

export interface StatusEventBase {
  type: string;
  timestamp: number;
}

export interface NodeLoginEvent extends StatusEventBase {
  type: 'node.login';
  event: {
    error?: string;
    settings?: {
      'key-uid': string;
      'display-name': string;
      'public-key': string;
      mnemonic: string;
      /** Трёхсловный псевдоним, например "Sarcastic Kind Eidolonhelvum". */
      alias?: string;
    };
  };
}

export interface GenericEvent extends StatusEventBase {
  event: any;
}

export type StatusEvent = NodeLoginEvent | MessagesNewEvent | GenericEvent;

export interface WalletBalance {
  symbol: string;
  balance: string; // wei или минимальные единицы, в виде строки
  decimals: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  from: string;
  text: string;
  timestamp: number;
}

/**
 * Запись чата в том виде, в каком её отдаёт status-go.
 *
 * Поле `chatType` — число, а не строка (см. `ChatType` в `messaging.ts`).
 * Поля сообщества (`communityId`, `categoryId`) заполнены только у каналов
 * внутри сообществ: по ним строится группировка в списке.
 */
export interface Chat {
  id: string;
  name: string;
  description?: string;
  color?: string;
  emoji?: string;
  /** Мягкое удаление: чат скрыт из списка. */
  active: boolean;
  chatType: number;
  timestamp: number;
  unviewedMessagesCount: number;
  unviewedMentionsCount: number;
  lastMessage?: ChatMessage | null;
  muted?: boolean;
  /** id сообщества, если чат принадлежит сообществу. */
  communityId?: string;
  /** id категории внутри сообщества. */
  categoryId?: string;
  /** Можно ли писать в канал (учитывает права и токен-гейт). */
  canPost?: boolean;
}

/** Канал внутри сообщества (`Community.chats` в ответе status-go). */
export interface CommunityChat {
  id: string;
  name: string;
  color?: string;
  emoji?: string;
  description?: string;
  canPost: boolean;
  canView: boolean;
  position?: number;
  categoryID?: string;
  tokenGated?: boolean;
  /** Подставляется на нашей стороне при разворачивании списка. */
  communityId?: string;
  communityName?: string;
}

export interface CommunityCategory {
  id: string;
  name: string;
  position?: number;
}

/**
 * Как сообщество пускает внутрь (`CommunityPermissions_Access`).
 *
 * Значения из internal/protocol/protobuf/communities.pb.go — можно
 * сравнивать числом, но в коде удобнее строкой:
 *   * `open`    — AUTO_ACCEPT (1), заявка принимается автоматически;
 *   * `request` — MANUAL_ACCEPT (3), решает владелец;
 *   * `token`   — есть право BECOME_MEMBER (type = 2), нужен токен;
 *   * `unknown` — UNKNOWN_ACCESS (0) или поля нет; трактуем как `request`,
 *                 потому что «всегда нужно просить доступ» — поведение
 *                 по умолчанию в status-go.
 */
export type CommunityAccess = 'open' | 'request' | 'token' | 'unknown';

/**
 * Права сообщества, вложенный объект `permissions`.
 *
 * `access` — число из перечисления; `ensOnly` приходит как `ens_only`
 * (тег encoding/json на protobuf-структуре).
 */
export interface CommunityPermissions {
  access?: number;
  ens_only?: boolean;
  private?: boolean;
}

/**
 * Токен-право (`CommunityTokenPermission`).
 *
 * `type` — перечисление: 1 BECOME_ADMIN, 2 BECOME_MEMBER, 3 CAN_VIEW_CHANNEL,
 * 4 CAN_VIEW_AND_POST_CHANNEL, 5 BECOME_TOKEN_MASTER, 6 BECOME_TOKEN_OWNER.
 */
export interface CommunityTokenPermission {
  id?: string;
  type?: number;
  token_criteria?: any[];
  chat_ids?: string[];
  is_private?: boolean;
}

/** Сообщество со всеми каналами и категориями. */
export interface Community {
  id: string;
  name: string;
  description?: string;
  color?: string;
  joined: boolean;
  isMember?: boolean;
  muted?: boolean;
  /** Просматривается без вступления (spectate). */
  spectated?: boolean;
  /** Карта id канала -> канал. Именно объект, а не массив. */
  chats: Record<string, CommunityChat>;
  /** Карта id категории -> категория. */
  categories: Record<string, CommunityCategory>;
  activeMembersCount?: number;
  /**
   * Вступление по заявке (MANUAL_ACCEPT).
   *
   * Внимание: `false` из-за того, что мы УЖЕ участники, и `false` из-за
   * того, что сообщество открытое, — неразличимы. Поэтому само по себе поле
   * не ответ: смотреть надо вместе с `joined`/`isMember`, а лучше — на
   * `permissions.access` через `communityAccess()`.
   */
  canRequestAccess?: boolean;
  /** Вступление без заявки (AUTO_ACCEPT) и мы ещё не участники. */
  canJoin?: boolean;
  permissions?: CommunityPermissions;
  tokenPermissions?: Record<string, CommunityTokenPermission>;
}

export interface MessagesNewEvent extends StatusEventBase {
  type: 'messages.new';
  event: {
    messages: ChatMessage[];
  };
}
