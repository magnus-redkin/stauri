# Stauri (Клиент Status на Tauri)

**Stauri** — это легкий десктопный клиент для экосистемы Status, разрабатываемый как активно развивающаяся альтернатива официальному `status-desktop`.

Построенный на базе **Tauri (Rust)** и **Svelte 5**, Stauri использует сайдкар-архитектуру (sidecar) для взаимодействия с бэкендом Status (`status-backend`) через локальные WebSocket и HTTP. Этот подход сохраняет всю мощь `status-go`, обеспечивая при этом современный, быстрый и гибкий пользовательский интерфейс.

## ✨ Ожидаемые преимущества перед `status-desktop`

- **Современный стек (Svelte 5 + Tailwind CSS):** Обеспечивает более быстрый и отзывчивый UI по сравнению со стеком Nim/QML, что значительно повышает скорость разработки и удобство использования.
- **Модульная архитектура:** Четкое разделение ответственности (Чат, Кошелек, Браузер dApps). Это упрощает поддержку кодовой базы, её расширение и адаптацию под новые функции.
- **Безопасность через изоляцию:** dApps открываются в изолированных окнах Tauri WebView, что уменьшает поверхность атаки по сравнению с монолитным QML-приложением. В будущих обновлениях будет добавлена безопасная инъекция `window.ethereum` с гранулированными разрешениями.
- **Нативная кроссплатформенность:** Tauri обеспечивает нативную поддержку Windows, macOS и Linux «из коробки» с минимальным размером бандла.
- **Расширяемость по дизайну:** Разделение UI и Rust-бэкенда позволяет легко внедрять пользовательские плагины и функции без вмешательства в ядро протокола Status.

## ⚙️ Конфигурация сети

По умолчанию Stauri подключается к **Ethereum Mainnet** и **Production-флоту Waku**. Однако вы можете легко переключиться на тестовые сети или использовать кастомные RPC для разработки.

### 🛡️ Изоляция данных
Чтобы предотвратить повреждение данных, Stauri изолирует сетевые данные. Mainnet использует корневую директорию данных приложения, в то время как тестовые сети создают изолированные поддиректории (например, `.../stauri/sepolia/`). Ваши профили и ключи Mainnet остаются в полной безопасности при тестировании на Sepolia.

### 🖥️ Индикация в интерфейсе
При подключении к тестовой сети Stauri предоставляет четкие визуальные сигналы:
- Оранжевый предупреждающий баннер в верхней части приложения.
- Подробная информация о сети (Имя сети, Chain ID, RPC URL, Waku Fleet), отображаемая в левой боковой панели в разделе Профиля.

## 📚 Документация

- [`docs/ru/architecture.md`](docs/ru/architecture.md) — общая архитектура, слои, поток данных.
- [`docs/ru/networks_and_balances.md`](docs/ru/networks_and_balances.md) — путь баланса на экран, RPC-форвардер, кэши `status-go`.
- [`docs/ru/status_outdated_architecture.md`](docs/ru/status_outdated_architecture.md) — почему `status-go` устроен сложно (RPC-клиенты, провайдеры).
- [`docs/ru/tests.md`](docs/ru/tests.md) — стратегия тестирования (unit, component, E2E, ручные проверки).
- [`BUILDING.md`](BUILDING.md) — сборка `status-backend` в Nix и подготовка sidecar.

## 🧩 Что уже реализовано

### 💼 Кошелёк (Wallet)

Главный экран кошелька — 5 вкладок: **Assets / Send / Receive / Buy / Swap**.

- **Assets** — список токенов, сгруппированных по `(symbol, chainGroup)`, где `chainGroup` = EVM (Ethereum, Optimism, Arbitrum, Base), BSC (Binance) или chainId. Иконки берутся из `cryptocurrency-icons` (по символу), fallback — Trust Wallet Assets (по адресу контракта) с кэшем в `localStorage`, последний fallback — буква. Нулевые балансы не отбрасываются, `hasError` показывается меткой.
- **Send** — форма-заглушка (токен, получатель, сумма, Review). Логика Router — в работе.
- **Receive** — адрес и QR-код (через `api.qrserver.com`), кнопка «Скопировать».
- **Buy** — вкладка disabled (OnRamp будет добавлен позже).
- **Swap** — вкладка disabled (Router/Swap будет добавлен позже).

В левой колонке — информация об аккаунте (`All accounts`, количество токенов, сокращённый адрес) и ссылка **Manage accounts** (иконка Wallet + карандаш).

### 📈 Market

Отдельный модуль, **не зависящий от `status-go`**:

- `src-tauri/src/market.rs` — Tauri-команда `fetch_market_data`, которая делает `reqwest` к CoinGecko (`/coins/markets`), передаёт `x-cg-demo-api-key` из `.env` и кэширует ответ на 60 секунд.
- `MarketMain.svelte` — таблица топ-50 монет (цена, 24h, объём, капитализация), иконки из CoinGecko (`image` URL).
- Ключ `COINGECKO_KEY` читается через `dotenv` при старте Rust. Если не задан — Market покажет ошибку «COINGECKO_KEY не задан».

Почему так: `status-go` умеет отдавать рыночные данные, но это тянет зависимость от `market-proxy` и его кэшей. Для Stauri проще и чище ходить в CoinGecko напрямую из Rust.

### 💬 Чат и контакты

- Список чатов (`ChatLeft`), окно сообщений (`ChatMain`), поиск, отправка.
- Контакты (`ContactsLeft`, `ContactsMain`), добавление по публичному ключу, принятие запросов.
- Бейдж непрочитанных запросов в сайдбаре.

### 🔐 Профиль

- Информация об аккаунте (Profile ID, Public Key, Network, Chain ID, RPC, Waku Fleet).
- Редактирование профиля (Display Name, ENS — отложено).
- Создание и проверка seed-фразы (плейсхолдер, не подключено к бэкенду).
- Отключение (`Disconnect`).

### 🖥️ Настройки

- Язык: **English / Русский / 中文 / Español**.
- Тема: **Maroon / Light / Dark**.
- Размер шрифта (12–20 px).

### 🌐 dApp-окна

`open_dapp_window` создаёт изолированное окно Tauri WebView с внешним URL. В будущем — безопасная инъекция `window.ethereum` с гранулированными разрешениями.

## ⚠️ Известные ограничения и сложности

- **Nix-сборка `status-backend`:** бинарник `status-backend` и `libsds.so` должны быть собраны **в одном Nix-окружении** (одна glibc, один ABI). Если собрать `status-backend` системным Go, а `libsds.so` взять из Nix store (или наоборот), `status-backend` падает с `SIGSEGV` при загрузке `libsds.so`. Подробности — в `BUILDING.md`.
- **`CGO_LDFLAGS`/`CGO_CFLAGS`:** локальные переменные (vosk, whisper, portaudio, onnxruntime) подмешивают системные библиотеки (например, `libmp3lame` под glibc 2.43) и ломают Nix-сборку. Перед `make status-backend` в Nix shell нужно `unset CGO_LDFLAGS CGO_CFLAGS`.
- **Nix-интерпретатор в `status-backend`:** у бинарников `INTERP` и `RUNPATH` указывают в `/nix/store`, поэтому на машине без этого стора `execve` возвращает `ENOENT`. `release.sh` переписывает их через `patchelf` на системный загрузчик и `$ORIGIN`-относительный `RPATH`. До этого патча `linuxdeploy` падал и на `ldd` (exit 139).
- **AppImage и Nix-glibc:** AppImage, собранный с Nix-овским `status-backend`, может падать на системах с другой glibc (например, Ubuntu 26.04). Для релиза нужен кроссплатформенный пайплайн сборки (избегающий Nix для продакшн-бинарников).
- **Накладные расходы сайдкара:** Запуск `status-backend` как отдельного процесса упрощает интеграцию, но требует тщательного управления жизненным циклом (запуск, остановка и предотвращение появления зомби-процессов).
- **Кэши `status-go`:** RPC-клиенты кэшируются навсегда, кэш балансов не инвалидируется. Это требует особого порядка запуска и локального RPC-форвардера (см. `docs/ru/networks_and_balances.md`).
- **Полнота функционала:** Send/Receive/Swap/Buy — в работе; инъекция `window.ethereum`, Manage Tokens, Sell — запланированы.

## 🚀 Текущий статус

Stauri находится в фазе активного прототипирования. Следующие ключевые функции уже работают:

- Динамический запуск сайдкара `status-backend` с автоматическим выделением порта и изоляцией `dataDir` с учетом сети.
- WebSocket-соединение для парсинга сигналов в реальном времени (`node.login`, `node.stopped`, `messages.new`).
- Создание аккаунта и вход в систему.
- Инициализация сервисов мессенджера и кошелька.
- Получение адресов кошелька (`accounts_getAccounts`, фильтр `chat = false`).
- Загрузка балансов с метаданными токенов (`wallet_getTokensForActiveNetworksMode`) и группировкой по сетям.
- Локальный RPC-форвардер (`127.0.0.1:43057`) и регистрация user-провайдера `stauri-rpc`.
- Перезапуск ноды при изменении провайдеров (только при `wroteProviders`).
- 5 вкладок кошелька (Assets / Send / Receive / Buy / Swap), группировка токенов, иконки, кэш.
- Market на CoinGecko (Rust-команда, кэш 60 с, ключ из `.env`).
- Чат и контакты (список, поиск, отправка, принятие запросов).
- Профиль (информация, редактирование, seed-фраза как плейсхолдер).
- Настройки (языки: en/ru/zh/es, темы: maroon/light/dark, размер шрифта).
- Открытие dApps в изолированных окнах Tauri (WebView).
- Динамическая конфигурация сети через переменные окружения или JSON.

**Цель:** Создать полнофункциональный, легкий и расширяемый клиент, который использует эту модульную архитектуру для предоставления всех необходимых функций Status.

## 🛠 Сборка из исходного кода

Stauri требует предварительно собранный бинарный файл `status-backend` и `libsds.so` из репозитория Status Go. Они должны быть собраны **в одном Nix-окружении**.

Подробные инструкции — в файле [BUILDING.md](./BUILDING.md). Кратко:

```bash
# 1. Собрать status-backend в Nix
cd ~/ETH/github.status-go
nix develop --extra-experimental-features 'nix-command flakes'
unset CGO_LDFLAGS CGO_CFLAGS
make status-backend
find /nix/store -name "libsds.so"   # взять ту, что в -L при линковке

# 2. Скопировать в Stauri
cp ~/ETH/github.status-go/build/bin/status-backend \
   ~/ETH/stauri/stauri-app/src-tauri/binaries/status-backend-x86_64-unknown-linux-gnu
cp /nix/store/<hash>-nim-sds-.../lib/libsds.so \
   ~/ETH/stauri/stauri-app/src-tauri/binaries/libsds.so

# 3. Запустить
cd ~/ETH/stauri/stauri-app
pnpm install
pnpm tauri dev

# 4. Собрать AppImage
./scripts/release.sh 0.2.0

# 🗺️ Roadmap (TODO)
## Сделано
- Запуск и остановка status-backend (sidecar, PID, зомби).
- WebSocket-сигналы (node.login, node.stopped, messages.new).
- Создание аккаунта и вход.
- Запуск мессенджера и кошелька.
- Адреса из accounts_getAccounts (chat = false).
- Балансы с метаданными (wallet_getTokensForActiveNetworksMode).
- RPC-форвардер и user-провайдер stauri-rpc.
- Перезапуск ноды при изменении провайдеров.
- 5 вкладок кошелька (Assets / Send / Receive / Buy / Swap), группировка токенов, иконки, кэш.
- Market на CoinGecko (Rust-команда, кэш 60 с, ключ из .env).
- Чат и контакты (список, поиск, отправка, принятие запросов).
- Профиль (информация, редактирование, seed-фраза как плейсхолдер).
- Настройки (4 языка, 3 темы, размер шрифта).
- dApp-окна (изолированные WebView).
- Динамическая конфигурация сети.

## В работе
- Send — перевод ETH/ERC-20. Требует Router (wallet_getSuggestedRoutesAsync), подписи и отправки (wallet_SendRouterTransactionsWithSignatures), обработки сигналов wallet.router.*.
- Receive — адрес и QR-код (UI готов, нужна интеграция с кошельком).
- AppImage — сборка работает, но status-backend из Nix падает на системах с другой glibc. Нужен кроссплатформенный пайплайн.

## Запланировано
- Swap + Bridge — обмен токенов. Использует тот же Router, что и Send, но с маршрутом. Провайдер — Relay/ParaSwap (зависит от версии status-go).
- Buy (OnRamp) — покупка крипты. Стандартный вариант — wallet_getCryptoOnRamps (MoonPay). Кастомные провайдеры (P2P, обменники) — через интерфейс BuyProvider (dApp-расширение).
- Покупка ETH имени (ENS) — регистрация ENS-имени. Требует Router и подписи, как Send.
- Контакты и чаты — полноценный обмен сообщениями (сейчас — только UI).
- Инъекция window.ethereum в dApp-окна с гранулированными разрешениями.
- Manage Tokens — скрытие токенов, фильтр «пыли», управление списками (CoinGecko, Status Token List).
- Manage accounts — Add, Rename, Remove, Set active.
- Sell (OffRamp) — продажа крипты за фиат. В status-go пока нет API; возможен через P2P-ссылки.

# 📦 Технологический стек
- Фронтенд: Svelte 5, SvelteKit, Tailwind CSS, shadcn-svelte
- Бэкенд: Rust, Tauri 2
- Интеграция со Status: status-backend (сайдкар), WebSocket (сигналы), HTTP (RPC)
- Market: CoinGecko API (через Rust-команду fetch_market_data)

# 🧪 Тестирование

Стратегия тестирования описана в docs/ru/tests.md. Кратко:
bash

### Rust unit-тесты
cd src-tauri && cargo test

### Frontend unit-тесты (Vitest)
pnpm test

### E2E (Playwright)
pnpm test:e2e
