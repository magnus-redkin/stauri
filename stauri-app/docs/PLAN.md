# План усиления Stauri

Документ фиксирует порядок работ по безопасности, архитектуре и общим
необходимостям. Каждый шаг — отдельный коммит, чтобы откат был точечным.

**Общая цель приложения:** от status-go используются только базовые функции
работы с сетью и кошельком. Всё, что можно вынести в отдельные модули,
выносится.

## Взаимозависимости

- Шаг 4 (типизированные ошибки) частично переписывается при Шаге 9
  (разбиение `lib.rs`). Это осознанно: Шаг 4 даёт быструю диагностику.
- Шаг 1 (CSP) требует знать все внешние источники. Собраны:
  - `ws://127.0.0.1:*` — сигналы status-go
  - `http://127.0.0.1:*` — `statusFetch`
  - `https://raw.githubusercontent.com` — логотипы токенов
  - `https://coin-images.coingecko.com` — картинки в Market
- Шаг 6 (аутентификация status-backend) блокирует Шаг 15: если выносить чат
  из status-go, способ доступа к ноде меняется. Поэтому Шаг 6 идёт раньше.

## Решение по Шагу 15

Выбран **вариант A**: `wakuext_*` остаются в status-go, но изолируются
в модуль `status/messaging.ts` с явной границей. Вариант B (полный вынос
чата/контактов в собственный слой) — после выхода переработанной версии
status-go.

---

## Этап 0. Подготовка

| # | Действие | Статус |
|---|---|---|
| 0.1 | Ветка `refactor/hardening` от `master` | |
| 0.2 | Baseline: `pnpm test` (94/94), `cargo test` | |
| 0.3 | `pnpm check` — исходное число предупреждений | |

## Этап 1. Безопасность и диагностика

### Шаг 1. CSP + области действия capabilities — ВЫПОЛНЕНО
`src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`,
`svelte.config.js`

- CSP задан в **SvelteKit** (`kit.csp`), а не в Tauri; в `tauri.conf.json`
  остаётся `"csp": null`. Причина: Tauri при `csp` != null переписывает HTML
  через `set_csp`, и две политики (заголовок Tauri + meta SvelteKit)
  перемножаются по правилам CSP — `script-src 'self' 'unsafe-inline'` из
  Tauri обнулил бы хеш SvelteKit.
- `mode: 'auto'`: в prod SvelteKit хеширует инлайн-бутстрап
  (`sha256-…`), в dev проставляет nonce. Директивы:
  `script-src 'self'` (без `unsafe-inline`), `style-src 'self' 'unsafe-inline'`
  (нужно для Tailwind/Svelte), `img-src` с githubusercontent/coingecko,
  `connect-src` с `127.0.0.1` и `ipc:`.
- Убраны `shell:allow-spawn`, `shell:allow-kill`, `opener:default`,
  `core:webview:allow-create-webview-window`: из фронтенда они не вызываются.
  Rust запускает sidecar через `ShellExt::sidecar()`, который не проходит
  через scope (`tauri-plugin-shell/src/lib.rs:71`), поэтому удаление
  разрешений на запуск backend не влияет.
- Проверено: хеш в CSP совпадает с инлайн-блоком (`MATCH`), dev отдаёт nonce.
  Тесты: 94/94, `cargo check` — OK.

### Шаг 2. Убрать логирование тел ответов — ВЫПОЛНЕНО
`src/lib/status/http.ts`, `vite.config.js`, `src/lib/status/http.test.ts`

- `statusFetch` больше не печатает тело запроса и ответа. Причина: ответ
  `settings_getSettings` содержит seed-фразу в поле `mnemonic`, и первые
  200 символов уходили в консоль webview.
- Текст ошибки тоже очищен: раньше в `Error` подставлялись фрагменты тела
  (`HTTP 500: <body>`, `Invalid JSON … <body>`). Теперь только статус/имя
  метода. Тесты обновлены и проверяют, что тело НЕ просачивается.
- `esbuild.drop` в Vite 8 не работает (Vite перешёл на rolldown, опция
  deprecated и молча игнорируется). Вместо неё — плагин
  `dropConsolePlugin` в `vite.config.js`: вырезает вызовы `console.*`
  через `renderChunk`, применяется только к production-сборке.
- Проверено: `console.log`/`console.debug` в бандле отсутствуют, синтаксис
  всех 12 чанков валиден (`node --check`), тесты 94/94.

### Шаг 3. CI — ВЫПОЛНЕНО
`.github/workflows/ci.yml` (в корне репозитория, не в `stauri-app/`)

- Две задачи: `frontend` (check, lint, test, build) и `rust`
  (fmt, clippy -D warnings, test) на ubuntu-24.04.
- `working-directory: stauri-app` для всех шагов: приложение живёт в подкаталоге.
- Ставится `webkit2gtk-4.1-dev` и прочие системные зависимости Tauri 2.
- Sidecar и `libsds.so` — артефакты Nix, в CI создаются пустышки.

**Что пришлось починить, чтобы CI был зелёным с первого прогона:**

- `svelte-check`: было 62 ошибки → 0. Причины: не подключены типы
  `@testing-library/jest-dom` (40 ошибок об одном), рассинхрон пропсов
  `WalletLeft` (`onNavigate` вместо `onManageAccounts`), устаревший
  playground, тест `PasswordInput` передавал несуществующий проп.
- `eslint`: 31 ошибка → 0. Введён `src/lib/utils/log.ts` — `debug()`
  становится no-op вне dev, поэтому отладочные сообщения не попадут
  в production даже если плагин вырезания сломается.
- `cargo fmt`: 26 расхождений в 3 файлах → применён `rustfmt`.
- `cargo clippy`: 14 предупреждений `collapsible_if` → 0.
- `src/routes/playground` удалён (по решению пользователя).

Тесты после всех правок: 94/94 vitest, 10/10 cargo test, lint 0 ошибок.

### Шаг 4. Типизированные ошибки в Rust
`src-tauri/src/error.rs` (новый)

- `enum AppError` с `thiserror`, `#[serde(tag = "kind")]`:
  `Network`, `Backend`, `Config`, `Io`, `Internal`.
- Фронтенд различает по `kind`, а не по тексту.

### Шаг 5. Seed-фраза вне webview
`src-tauri/src/lib.rs`, `src/lib/status/api.ts`, `CreateSeed.svelte`

- Команда Rust `fetch_seed_phrase()`: фраза в памяти Rust, отдаётся
  по словам через `seed_word(index)`.
- Удалить `getSettingsWithMnemonic` из фронтенда.

### Шаг 6. Локальная аутентификация status-backend — ВЫПОЛНЕНО
`src-tauri/src/auth_proxy.rs` (новый), `src/lib/status/http.ts`,
`src/lib/stores/connectionStore.svelte.ts`

Установлено по исходникам status-go:
- `cmd/status-backend/server/server.go:184` — `CheckOrigin` возвращает `true`.
- Токена на HTTP-API в `status-backend` нет.
- Loopback общий для всех пользователей машины (`ss -tlnp`), поэтому
  другой локальный пользователь тоже может подключиться.

Решение: отдельный аутентифицирующий прокси на стороне Rust.
- Слушает свой порт, требует заголовок `X-Stauri-Token`.
- Токен — 32 байта из `/dev/urandom`, стабилен на время работы.
- Сравнение constant-time; заголовок вырезается перед пересылкой бэкенду.
- После проверки — `copy_bidirectional`, поэтому WebSocket upgrade
  проходит прозрачно.
- `StartBackendResponse` теперь отдаёт `authPort`; фронтенд ходит только
  через него. Порт бэкенда наружу не отдаётся.
- WS-плагин Tauri принимает `ConnectionConfig.headers`, поэтому токен
  уходит и в WebSocket.

**Остаточный риск:** токен лежит в webview (нужен для заголовков), при XSS
он доступен. Закрывается только полный разрыв с локальными процессами;
при XSS у атакующего и без того есть доступ к Tauri-командам.

Тесты: Rust 17/17 (+4 на прокси), vitest 94/94, clippy 0.

## Этап 2. Архитектура

### Шаг 7. Мёртвые команды и поверхность атаки
- `greet` — не вызывается.
- `open_dapp_window` (`lib.rs:386`) — не вызывается, создаёт окно на
  произвольный внешний URL.
- `tauri-plugin-opener` — подключён (`lib.rs:500`), `openUrl` не вызывается.

### Шаг 8. Целостность загрузок в `release.sh`
- Зафиксировать версии `linuxdeploy` и плагина.
- Проверять `sha256sum` после `wget`.

### Шаг 9. Разбиение `lib.rs` (622 строки)
`sidecar.rs`, `commands.rs`, `env.rs`, `lib.rs` (только `run()`).

### Шаг 10. Единый модуль конфигурации ключей
`src/lib/config/keys.ts` — все ключи и RPC-адреса в одном месте.

### Шаг 11. `PREFERRED_PORT` без молчаливого fallback
`rpc_proxy.rs:69-78` — при занятом порте URL в БД status-go указывает
на старый порт.

### Шаг 12. Разбиение `connectionStore.svelte.ts` (385 строк) — ВЫПОЛНЕНО
`connection.ts`, `rpcConfig.ts`, `ws.ts`.

Фактически: `rpcConfig.ts` (`configureWalletRpc` + `ConfigureResult`),
`ws.ts` (`openWs`/`closeWs`/`isWsOpen`) и `connection.svelte.ts`
(`connectionState`, `connect`, `changeNetwork`, `login`, `createAccount`,
`disconnect`). Сам `connectionStore.svelte.ts` превратился в реэкспорт-фасад
на 40 строк — публичный API не изменился, ни один импортёр и ни один тест
править не пришлось.

Файл назван `connection.svelte.ts`, а не `connection.ts`: `connectionState`
объявлен через `$state`, а руну вне `.svelte.ts` компилятор не примет.

### Шаг 13. Структурное логирование в Rust — ВЫПОЛНЕНО
`tracing` + `tracing-subscriber` + `tracing-appender`, без ротации снаружи.

Новый модуль `src-tauri/src/logging.rs`:

* файл `<data_local_dir>/com.magnus.stauri-app/logs/stauri.<дата>.log`,
  суточная ротация, 7 файлов; пишется неблокирующе, очередь досбрасывается
  в `RunEvent::Exit` (`logging::shutdown()`);
* stderr: `debug` в dev, `warn` в release;
* `RUST_LOG` переопределяет фильтр — и загружается он из `.env`, поэтому
  `env::load_env()` вызывается ДО `logging::init()`, а предупреждение об
  отсутствии `.env` печатается уже после (для этого `load_env` возвращает
  `bool`).
* `RedactingWriter` вычищает секреты на уровне приёмника, целиком на строку:
  ключ Alchemy/Infura в пути URL, длинный token-сегмент (QuickNode),
  `apikey=`/`token=`/`password=` в query, `user:pass@`, и `"authToken":"..."`
  в JSON от status-go. Чистка на выходе, а не на каждом вызове — забыть
  нельзя, и чужие ошибки (`reqwest` печатает URL в тексте ошибки) тоже
  закрыты.
* Все `println!`/`eprintln!` заменены на `tracing`; вывод `status-backend`
  идёт с `target: "status_backend"`, stdout на `debug`, stderr на `info`.

11 unit-тестов на вычищение, включая разрез ключа между двумя `write`. Заменяет отключённый `status.log`.

### Шаг 14. Согласовать bundle targets — ВЫПОЛНЕНО
`"targets": "deb"` при ручной сборке AppImage означал, что конфиг и
`release.sh` говорили разное: скрипт отменял обещание флагами
`--no-bundle`, а `pnpm tauri build` без скрипта неожиданно собирал `.deb`.

Теперь `"targets": []` — бандлинг выключен в конфиге, и это проверено:
`pnpm tauri build` отрабатывает, артефактов не создаёт. `--no-bundle` из
`release.sh` убран, источник истины один — конфиг.

Попутно в `release.sh` (нашлось при проверке):

* нумерация шагов была `/6` при семи шагах — исправлена;
* перед сборкой удаляется `*.AppImage` прошлой сборки: иначе при сбое
  `linuxdeploy` шаг проверки находил старый файл и рапортовал об успехе,
  отдавая предыдущую версию под тем же именем;
* проверка берёт самый свежий AppImage, а не первый из `find`.

Документация поправлена: `docs/ru/architecture.md`, оба README — там
описывался обход `ldd` через `/tmp/bin/ldd`, который из скрипта уже удалён
(после патча интерпретатора `ldd` работает штатно).

### Шаг 15. Граница status-go (вариант A)
Изолировать `wakuext_*` в `status/messaging.ts`.

## Этап 3. Общие необходимости

| # | Задача | Статус |
|---|---|---|
| 16 | AppStream-метаданные | ВЫПОЛНЕНО |
| 17 | Git-тег в `release.sh` | ВЫПОЛНЕНО |
| 18 | Подпись AppImage + sha256 | ВЫПОЛНЕНО |
| 19 | Автообновление | ВЫПОЛНЕНО |
| 20 | Интеграционный тест прокси | ВЫПОЛНЕНО |
| 21 | Отправка средств (`alert('Send not implemented yet')`) | |
| 22 | Восстановление по seed (placeholder) | |
| 23 | Убрать `routes/playground` из релиза | |

### Шаг 20. Интеграционный тест прокси — ВЫПОЛНЕНО

Было: в `rpc_proxy` один сквозной тест, и тот ходил в настоящий
`ethereum-rpc.publicnode.com`. В CI без сети и при лимитах провайдера он
падал бы по причинам, не связанным с кодом. В `auth_proxy` проверялся только
разбор строк — ни один тест не подтверждал, что запрос без токена реально не
доходит до бэкенда.

Стало, `src/rpc_proxy.rs` (5 тестов, все на локальном мок-сервере):

* `proxies_json_rpc_request` — сквозной путь, тело upstream доходит до
  клиента без изменений (раньше проверялось только, что результат похож на
  hex-число);
* `unknown_chain_returns_503`;
* `dead_upstream_returns_502` — мёртвый провайдер даёт JSON-RPC-ошибку, а не
  обрыв соединения;
* `set_upstreams_takes_effect_without_restart` — смена таблицы на лету;
* `bad_chain_id_does_not_panic` — мусор в пути не роняет процесс.

`src/auth_proxy.rs` (+4 теста, итого 9): фальшивый бэкенд со счётчиком
запросов проверяет главное свойство прокси.

* `valid_token_is_forwarded_to_backend` — с токеном ответ доходит;
* `missing_token_is_rejected_and_backend_untouched` — 403, и счётчик
  бэкенда равен нулю;
* `wrong_token_is_rejected` — то же для неверного токена;
* `token_header_is_stripped_before_forwarding` — секрет не уезжает в
  status-go.

Всего Rust-тестов: 37 (было 29). Сеть в тестах не используется нигде.

### Шаг 19. Автообновление — ВЫПОЛНЕНО

Плагины `tauri-plugin-updater` 2.14.1 и `tauri-plugin-process` 2.4.0.

**Почему команды, а не JS-плагин.** `@tauri-apps/plugin-updater` работает из
webview и требует permission `updater:default`. Права webview мы намеренно
сужаем, поэтому permission в `capabilities/default.json` не выдан: фронтенд
ходит через `check_for_update` и `install_update` в `src-tauri/src/updater.rs`.
Логика и адрес сервера остаются в Rust.

**Пустой ключ — не ошибка.** Пока `plugins.updater.pubkey` пуст,
`check_for_update` возвращает `None` и не ходит в сеть. Иначе было бы хуже:
подпись проверяется только на установке, так что интерфейс показал бы
«доступно обновление», а «Установить» упало бы на декодировании пустого
ключа — пользователь увидел бы заведомо нерабочую кнопку.

**Манифест.** `release.sh` собирает `latest.json` в формате «static» с ключом
`linux-x86_64` (это `updater_os + "-" + updater_arch` в плагине) и ссылкой на
артефакт тега. Загружать в релиз нужно три файла: AppImage, `.sig`, `latest.json`.

**Интерфейс.** Настройки → «Версия»: текущая версия, кнопка проверки, при
наличии обновления — заметки к релизу и кнопка установки. После установки
честно просим перезапуск: на Linux файл подменяется на месте, и текущий
процесс продолжает работать со старым кодом. Строки добавлены во все четыре
локали.

**Что нужно сделать вручную:** сгенерировать ключ подписи
(`pnpm tauri signer generate -w ~/.tauri/stauri.key`) и вписать публичную
часть в `plugins.updater.pubkey`. Без этого шага кнопка проверки честно
отвечает «установлена последняя версия», не обращаясь к серверу.

### Шаги 16–18 — ВЫПОЛНЕНО

**16. AppStream.** `src-tauri/metainfo/com.magnus.stauri-app.metainfo.xml`:
`id` совпадает с Tauri `identifier`, `launchable` — с именем `.desktop`.
Проходит `appstreamcli validate` (осталось три info о регистре первого слова
в русском тексте — на британский английский они не влияют, но и не мешают).
Кладётся в `usr/share/metainfo/` при упаковке. Блок `<screenshots>` убран
намеренно: скриншотов в репозитории нет, а ссылка на несуществующий файл
хуже, чем её отсутствие.

`.desktop` доведён до стандарта: `GenericName`, `Comment`, `Keywords`,
`StartupWMClass`. Проверяется `desktop-file-validate` на сборке.
Иконки раскладываются по `hicolor` четырёх размеров (32/128/256/512), а не
только 128 — раньше на HiDPI использовался растянутый мелкий файл.

**17. Git-тег.** Ставится ПОСЛЕ успешной сборки (`git tag -a v$VERSION`),
иначе тег указывал бы на код, из которого артефакт не собран. Перед сборкой
скрипт отказывается работать, если тег уже существует, и предупреждает,
если дерево грязное. Push не делается — отправка в remote остаётся решением
человека.

Заодно подъём версии стал согласованным. Раньше `release.sh` правил только
`package.json` и `tauri.conf.json`, а `Cargo.toml` оставался на 0.1.0 при
релизе 0.2.0. Теперь обновляются все четыре места, включая `<release>` в
metainfo.

**18. Подпись и sha256.** Рядом с AppImage появляются `.sha256`
(в формате `sha256sum -c`) и `.sig` от `tauri signer sign --app-version`.
Ключ берётся из `TAURI_SIGNING_PRIVATE_KEY_PATH` или
`TAURI_SIGNING_PRIVATE_KEY`; если его нет — предупреждение, но сборка не
падает. `--app-version` привязывает подпись к версии: она попадает в
подписанный trusted comment, и updater с `requireSignedVersion` отвергнет
манифест с подменённым номером.

Проверки, исполнявшиеся вручную: `desktop-file-validate` на новом `.desktop`,
`appstreamcli validate`, подъём версии в `Cargo.toml` и metainfo, генерация
`.sha256` с последующим `sha256sum -c`, подпись тестовым ключом с проверкой
имени `.sig`. Полный прогон `release.sh` не делался — он перезаписывает
версии и ставит тег.

## Порядок и точки остановки

```
1  CSP + scope           → тесты вручную
2  http.ts логи          → тесты вручную
3  CI                    → тесты вручную
4  Типизированные ошибки → тесты вручную
5  Seed вне webview      → тесты вручную
6  Аутентификация ноды   → тесты вручную (самый рискованный)
7  Мёртвый код
8  release.sh хеши
9  Разбиение lib.rs
10 Ключи в один модуль
11 PREFERRED_PORT
12 Разбиение connectionStore
13 tracing
14 bundle targets
15 Граница status-go
16–20 общее
21–23 фичи (по подтверждению)
```
