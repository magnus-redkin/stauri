/**
 * История переходов внутри приложения.
 *
 * ## Зачем
 *
 * До сих пор «назад» существовало только в двух местах и вручную: кнопка ← в
 * панели dApp и повторный клик по иконке раздела. Из чата в список, из
 * профиля в домашний экран, из открытого сообщества в каталог — везде
 * приходилось помнить, откуда пришёл. Alt+← / Alt+→ дают то же поведение,
 * что в браузере, и работают одинаково во всех разделах.
 *
 * ## Почему снимок состояния, а не «шаг назад по разделам»
 *
 * Пользователь возвращается не в раздел, а в то место, из которого ушёл:
 * из чата — в тот же чат, из каталога — в раскрытое сообщество. Поэтому
 * история хранит снимок ключевых состояний, а не просто имя раздела.
 *
 * ## Почему нельзя сделать это в webview средствами браузера
 *
 * У SvelteKit здесь SPA без настоящей истории: `history.back()` вернул бы
 * на другой URL, а у нас один. Поэтому стек свой.
 *
 * ## Как записывается
 *
 * Стек не размечается вручную в каждом месте навигации — это легко забыть.
 * Вместо этого `+page.svelte` следит за ключевыми состояниями и вызывает
 * [`record`] после каждого изменения. Ключевая строка (`key`) сравнивается с
 * текущей вершиной: одинаковые подряд не пишутся, иначе «назад» возвращало
 * бы в то же место.
 */

export interface NavSnapshot {
  /** Раздел верхнего уровня (`home`, `chat`, `dapps`, …). */
  section: string;
  /** Выбранный чат (id) или `null`. */
  chatId: string | null;
  /** Открытый провайдер в разделе dApp или `null`. */
  dappView: string | null;
  /** Выбранное сообщество в каталоге (id) или `null`. */
  communityId: string | null;
  /** Экран восстановления. */
  showRecovery: boolean;
  /** Экран seed-фразы. */
  showCreateSeed: boolean;
}

/** Максимум шагов: глубже пользователь всё равно не возвращается. */
const MAX_STEPS = 50;

interface Entry {
  key: string;
  snapshot: NavSnapshot;
}

export const navState = $state({
  /** Позиция в истории; -1 — истории нет. */
  index: -1,
  /** Можно ли шагнуть назад/вперёд — для кнопок в интерфейсе. */
  canBack: false,
  canForward: false,
});

// Стек и применятель живут вне `$state`: это не то, что читает шаблон.
// Читаются только `canBack`/`canForward` выше.
let stack: Entry[] = [];
let applyFn: ((s: NavSnapshot) => void) | null = null;

/**
 * Регистрирует функцию восстановления состояния.
 *
 * Вызывается из `+page.svelte` один раз: только он знает, как выставить
 * раздел и вложенные экраны. Стор не импортирует компонент, чтобы не
 * получилось цикла.
 */
export function registerNavigationApplier(fn: (s: NavSnapshot) => void): void {
  applyFn = fn;
}

function syncFlags(): void {
  navState.canBack = navState.index > 0;
  navState.canForward = navState.index >= 0 && navState.index < stack.length - 1;
}

/** Строка-идентификатор снимка: по ней отсеиваются повторы. */
function keyOf(s: NavSnapshot): string {
  return [
    s.section,
    s.chatId ?? '',
    s.dappView ?? '',
    s.communityId ?? '',
    s.showRecovery ? 'r' : '',
    s.showCreateSeed ? 's' : '',
  ].join('|');
}

/**
 * Записывает текущее состояние как шаг истории.
 *
 * Если пользователь перед этим вернулся назад, «будущее» отбрасывается —
 * так же, как в браузере: новый переход из середины истории начинает новую
 * ветку.
 */
export function record(snapshot: NavSnapshot): void {
  const key = keyOf(snapshot);

  // Тот же экран, что и текущая вершина: это не переход, а перерисовка
  // (например, пришло новое сообщение). Ничего не пишем.
  if (navState.index >= 0 && stack[navState.index]?.key === key) return;

  // Переход из середины: обрезаем всё, что было «впереди».
  if (navState.index < stack.length - 1) {
    stack = stack.slice(0, navState.index + 1);
  }

  stack.push({ key, snapshot });
  if (stack.length > MAX_STEPS) stack.shift();

  navState.index = stack.length - 1;
  syncFlags();
}

/** Шаг назад. `true`, если что-то восстановили. */
export function goBack(): boolean {
  if (navState.index <= 0 || !applyFn) return false;
  navState.index -= 1;
  applyFn(stack[navState.index].snapshot);
  syncFlags();
  return true;
}

/** Шаг вперёд. `true`, если что-то восстановили. */
export function goForward(): boolean {
  if (navState.index >= stack.length - 1 || !applyFn) return false;
  navState.index += 1;
  applyFn(stack[navState.index].snapshot);
  syncFlags();
  return true;
}

/**
 * Сбрасывает историю.
 *
 * Нужно при выходе из аккаунта: возвращаться в чаты предыдущего профиля
 * нельзя, а переход назад по чужой истории показал бы пустые экраны.
 */
export function resetNavigation(): void {
  stack = [];
  navState.index = -1;
  syncFlags();
}

/** Только для тестов. */
export function _debugStack(): string[] {
  return stack.map((e) => e.key);
}
