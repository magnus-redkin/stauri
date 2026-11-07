/**
 * Раздел dApp: внешние источники данных.
 *
 * ## Что здесь лежит
 *
 * Провайдеры по `docs/ru/providers_and_dapps.md` — сторонние источники,
 * отдающие **данные** по фиксированной схеме. Код от них не приходит.
 *
 * Два первых провайдера:
 *   * `communities` — каталог сообществ из контракта Directory. Живёт здесь,
 *     потому что это провайдер, а не основная сущность; отдельного раздела
 *     «Сообщества» в навигации больше нет.
 *   * `feed` — лента по URL (RSS/Atom либо `t.me/s/<name>`).
 *
 * ## Инварианты из документа
 *
 * * склейка локальная: провайдер получает «дай список», а не «что у меня есть»;
 * * происхождение показывается всегда и не отключается;
 * * порядок задаём мы, не провайдер;
 * * один сломанный источник не ломает остальные.
 */

import { invoke } from "@tauri-apps/api/core";
import { warn } from "$lib/utils/log";
import { formatError } from "$lib/utils/errors";

/** Вид провайдера. Категория — строка, как решено в документе. */
export type ProviderKind = "communities" | "feed";

export interface ProviderEntry {
  kind: ProviderKind;
  /** Иконка-глиф: без внешних ассетов. */
  icon: string;
  /** Ключ локализации заголовка. */
  title: string;
  /** Ключ локализации подзаголовка. */
  subtitle: string;
  /** Можно ли отключить. Встроенные (каталог) — нет. */
  removable: boolean;
}

/** Элемент ленты — то же, что отдаёт `fetch_feed` в Rust. */
export interface FeedItem {
  url: string;
  title: string;
  summary: string;
  published_at: number | null;
}

export interface FeedResponse {
  title: string;
  items: FeedItem[];
  /** Чей это элемент: `t.me/<name>` или хост. Показывается всегда. */
  source: string;
}

/**
 * Пример dApp в списке.
 *
 * Список сознательно смешивает три вида, потому что для пользователя они
 * выглядят одинаково — строкой с именем и иконкой. Разница видна только
 * после клика, и это нормально: она в том, где открывается интерфейс.
 *
 * * `builtin` — наш экран внутри Stauri (каталог сообществ). Выглядит как
 *   dApp, но данные остаются у нас, и подключение выполняем мы;
 * * `external` — настоящее чужое приложение: отдельное окно, свой origin,
 *   к нашим данным доступа нет;
 * * `prefill` — не dApp вовсе, а добавление провайдера: клик подставляет
 *   адрес в поле ввода соответствующей категории.
 */
export type DappExampleKind = "builtin" | "external" | "prefill";

export interface DappExample {
  id: string;
  /** Иконка-глиф: без внешних ассетов. */
  icon: string;
  /** Ключ локализации названия. */
  title: string;
  /** Ключ локализации подзаголовка. */
  subtitle: string;
  kind: DappExampleKind;
  /** `builtin`: какой провайдер открыть. */
  provider?: ProviderKind;
  /** `external`: адрес окна. */
  url?: string;
  /** `prefill`: куда подставить адрес. */
  prefill?: { field: "feedUrl"; value: string };
}

export const dappsState = $state({
  providers: [
    {
      kind: "communities",
      icon: "◇",
      title: "Community directory",
      subtitle: "Browse communities from the Status contract",
      removable: false,
    },
    {
      kind: "feed",
      icon: "📡",
      title: "Channel feed",
      subtitle: "RSS, Atom or a public Telegram channel",
      removable: false,
    },
  ] as ProviderEntry[],

  /** Открытый провайдер (null — ничего не выбрано). */
  active: null as ProviderKind | null,

  /**
   * Черновик адреса ленты в поле ввода.
   *
   * Сами подписки живут в `feedsStore`: они переживают перезапуск и
   * показываются в списке чатов, а черновик — нет.
   */
  feedUrl: "",

  /** Поле ввода адреса dApp. */
  dappUrl: "",
  /** Ошибка открытия окна dApp (обычно — адрес не прошёл проверку). */
  dappError: "",
});

/**
 * Примеры dApp.
 *
 * Порядок задаём мы (`docs/ru/providers_and_dapps.md` §9.3): сначала то, что
 * пользователь чаще всего хочет открыть, в конце — добавление провайдеров,
 * которые dApp не являются и не должны выглядеть ими в этом же списке.
 *
 * Встроенный каталог стоит первым намеренно: он единственный работает без
 * сети и без чужого сервера, то есть подсказывает пользователю, что такой
 * экран вообще существует.
 */
export const dappExamples: DappExample[] = [
  {
    id: "community-directory",
    icon: "◇",
    title: "Community directory",
    subtitle: "Built into Stauri: browse and join communities",
    kind: "builtin",
    provider: "communities",
  },
  {
    id: "remix",
    icon: "⬡",
    title: "Remix IDE",
    subtitle: "External dApp: write and compile Solidity contracts",
    kind: "external",
    url: "https://remix.ethereum.org",
  },
  {
    id: "etherscan",
    icon: "🔍",
    title: "Etherscan",
    subtitle: "External dApp: inspect any contract on mainnet",
    kind: "external",
    url: "https://etherscan.io",
  },
  {
    id: "add-feed",
    icon: "📡",
    title: "Add a feed",
    subtitle:
      "Adds a provider: an RSS/Atom address, or a channel read through an RSS bridge",
    kind: "prefill",
    prefill: { field: "feedUrl", value: "" },
  },
];

export function selectProvider(kind: ProviderKind | null) {
  dappsState.active = kind;
}

/**
 * Возвращает раздел к началу: экран примеров и пустая строка адреса.
 *
 * Нужен для двух вещей, и обе — про ожидание пользователя:
 *   * кнопка «назад» в панели провайдера;
 *   * повторный клик по иконке dApps в нулевой колонке.
 *
 * Второе важно, потому что `activeSection` и так равен `dapps`: без явного
 * сброса клик «на свою же вкладку» не делал бы ничего, хотя пользователь
 * ждёт выхода из открытого каталога к началу компонента.
 *
 * Подписки НЕ очищаются: это сохранённые данные, а не навигация. Смотреть на
 * них пользователь вернётся, выбрав провайдера снова.
 */
export function resetDappsView() {
  dappsState.active = null;
  dappsState.dappError = "";
  dappsState.feedUrl = "";
}

/**
 * Открывает внешний dApp в отдельном окне.
 *
 * Проверка адреса — в Rust (`dapp.rs`), не здесь: решение «можно ли открыть
 * этот origin» не должно зависеть от того, что успел выполнить webview.
 *
 * Связи с основным окном нет by design (§12): обратно пользователь переносит
 * только текст — скопированным адресом канала или строкой, которую вставит сам.
 */
export async function openDapp(url?: string): Promise<void> {
  const target = (url ?? dappsState.dappUrl).trim();
  if (!target) {
    dappsState.dappError = "Enter a dApp address";
    return;
  }

  dappsState.dappError = "";
  try {
    await invoke<string>("open_dapp", { url: target });
    if (!url) dappsState.dappUrl = "";
  } catch (e) {
    dappsState.dappError = formatError(e);
    warn("[dapps] failed to open dApp:", e);
  }
}

/**
 * Действие по клику на пример.
 *
 * Три вида ведут себя по-разному, и это вся разница между ними: `builtin`
 * переключает наш собственный экран, `external` открывает окно, `prefill`
 * только заполняет поле — пользователь ещё увидит адрес и нажмёт «добавить».
 * Последнее важно: провайдер не должен появляться без явного подтверждения.
 */
export function activateExample(example: DappExample): void {
  switch (example.kind) {
    case "builtin":
      if (example.provider) selectProvider(example.provider);
      break;
    case "external":
      if (example.url) void openDapp(example.url);
      break;
    case "prefill":
      if (example.prefill) {
        dappsState.feedUrl = example.prefill.value;
        selectProvider("feed");
      }
      break;
  }
}

export function removeProvider(kind: ProviderKind) {
  const idx = dappsState.providers.findIndex((p) => p.kind === kind);
  if (idx < 0) return;
  const provider = dappsState.providers[idx];
  if (!provider.removable) return;

  dappsState.providers.splice(idx, 1);
  if (dappsState.active === kind) dappsState.active = null;
}

// `loadFeed` и `normalizeFeedUrl` удалены: загрузка ленты переехала в
// `feedsStore`, потому что добавление адреса теперь создаёт подписку и
// запись в списке чатов, а не только просмотр в панели провайдера.
// Держать вторую копию нормализации адреса значило бы иметь два места,
// которые разойдутся при первой же правке.

export function resetDapps() {
  dappsState.active = null;
  dappsState.feedUrl = "";
}
