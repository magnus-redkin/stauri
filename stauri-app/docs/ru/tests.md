# Тестирование Stauri

Документ описывает, что и как тестируется, почему выбраны именно эти
инструменты и где проходят границы между уровнями тестов.

## 1. Уровни

| Уровень | Инструмент | Что проверяет |
|---|---|---|
| Rust unit | `cargo test` | Конфигурация сети, парсинг RPC URL, выбор `dataDir`, тесты `rpc_proxy` |
| Frontend unit | Vitest + happy-dom | Сторы, API-обёртки, разбор ошибок `statusFetch` |
| Frontend component | Vitest + `@testing-library/svelte` | Svelte-компоненты (формы, списки) |
| E2E | Playwright | Полный цикл: запуск Tauri, старт `status-backend`, отрисовка UI |

Граница: **unit-тесты не запускают `status-backend`**. Всё, что требует
реального бэкенда, — либо мокается, либо уходит в E2E.

## 2. Rust unit-тесты

Живут в `src-tauri/src/lib.rs` (модуль `#[cfg(test)]`) и в
`src-tauri/src/rpc_proxy.rs`.

```bash
cd src-tauri
cargo test
```

Что покрыто:

    default_rpc_url для mainnet / sepolia / holesky / неизвестной сети.

    config_for_network: валидные сети, невалидный preset, дефолты.

    data_dir_suffix: изоляция mainnet / sepolia / holesky.

    rpc_proxy: проксирование JSON-RPC, 503 для неизвестной сети.

Чего не покрыто (и почему):

    Реальная работа status-backend — это E2E.

    Поведение status-go при перезапуске ноды — только ручная проверка
    (см. §5).

## 3. Frontend unit-тесты (Vitest)

Конфигурация — в vite.config.js (test), среда — happy-dom, setup —
src/test-setup.ts (мок $lib/i18n).
```bash
pnpm test
```
# или в режиме наблюдения:
```bash
pnpm test:watch
```

## 3.1. Что мокается
Мок	Зачем
@tauri-apps/api/core (invoke)	Не запускать Rust-команды
@tauri-apps/plugin-http (fetch)	Не ходить в сеть
$lib/status/api	Изолировать стор от реальных вызовов
./statusStore.svelte	Изолировать стор от глобального состояния
$lib/i18n	Вернуть ключ вместо перевода

## 3.2. Что покрыто по файлам

    walletStore.test.ts — адреса из accounts_getAccounts (!chat),
    метаданные из getTokensForActiveNetworksMode, нулевые балансы не
    отбрасываются, три состояния rpcError, сброс.

    chatsStore.test.ts, contactsStore.test.ts — загрузка, выбор,
    сброс.

    statusStore.test.ts — processSignal (node.login, messages.new,
    ошибки), resetState, setNetworkInfo.

    api.test.ts — параметры вызовов (startBackend,
    initializeApplication, loginAccount).

    http.test.ts — успех, пустой ответ, HTTP-ошибка, невалидный JSON,
    error строкой и объектом.

    connectionStore.test.ts — порядок запуска, wroteProviders,
    перезапуск ноды, createAccount с keyUid и без.

    Компоненты: PasswordInput, MainEntryScreen, NetworkPicker,
    ProfileLoginBlock, NetworkInfo, ChatLeft, ContactsLeft,
    formatBalance.

## 3.3. Правила написания

    Один тест — одно утверждение (или одна логическая группа).

    Моки в beforeEach, vi.clearAllMocks() — чтобы тесты не влияли
    друг на друга.

    Не тестировать внутренности, только публичное поведение стора.

    Если тест требует status-backend — это не unit, это E2E.

## 4. E2E-тесты (Playwright)

Конфигурация — playwright.config.ts. Запускает реальный pnpm tauri dev,
ждёт http://localhost:1420, взаимодействует с окном.

```bash
pnpm test:e2e
```
# или с графическим интерфейсом:

```bash
pnpm test:e2e:ui
```

Что покрыто:

    Отрисовка заголовка «Stauri».

    Появление поля пароля.

    Ввод пароля и появление кнопки действия.

Чего не покрыто (и почему):

    Полный логин с реальным status-backend — долго и нестабильно.

    Перезапуск ноды при wroteProviders — требует реального профиля
    (см. §5).

## 5. Ручные проверки

Некоторые вещи нельзя проверить автоматически без реального
status-backend и сети. Их проверяют руками по чек-листу.
## 5.1. Чистый профиль

    Удалить ~/.local/share/com.magnus.tauri-app/mainnet.

    pnpm tauri dev, создать аккаунт, залогиниться.

    В логах искать [restart], node.stopped, configureWalletRpc.

    Открыть Wallet: балансы должны быть без hasError.

## 5.2. Повторный вход

    Не удаляя dataDir, перезапустить приложение.

    В логах не должно быть [restart] (провайдер уже в БД,
    wroteProviders === false).

    Балансы должны загрузиться сразу.

## 5.3. Форвардер

```bash
curl -s -X POST http://127.0.0.1:43057/1 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

Должен вернуть {"result":"0x..."}.

## 6. Чего не хватает (TODO)

    Маскирование ключей в логах. statusFetch маскирует только
    password; alchemyApiKey, infuraToken уходят в консоль открытым
    текстом.

    Интеграционный тест на порядок запуска с реальным status-backend
    (сейчас — только моки).

    Тест на node.stopped с таймаутом (сейчас waitForNodeStopped не
    бросает, но тест на это не написан).

    Тест на ensureNetworksConfigured (если функция останется).

    Покрытие rpc_proxy на реальном upstream (сейчас — только
    eth_blockNumber на publicnode).

## 7. Инварианты

    Unit-тесты не запускают status-backend.

    E2E не проверяют бизнес-логику — только отрисовку и базовый цикл.

    Всё, что зависит от сети/кэшей status-go, проверяется руками по
    чек-листу.

    Моки — только на границах (api.ts, http.ts, invoke), не внутри
    стора.
