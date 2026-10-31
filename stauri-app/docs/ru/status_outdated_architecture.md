# Status-go: почему балансы не работают и как это чинить

## 1. Что такое RPC-провайдер и зачем он нужен

Блокчейн — это распределённая база данных. Чтобы узнать баланс кошелька или отправить транзакцию, приложение должно выполнить запрос к узлу сети (ноде). Своя полная нода Ethereum — это сотни гигабайт данных и постоянная синхронизация. Поэтому почти все кошельки используют RPC-провайдеров — компании, которые держат ноды и продают доступ к ним через HTTP API.

Stauri (как и официальный Status) не общается с блокчейном напрямую. Он формирует JSON-RPC запрос (например, eth_getBalance или eth_call) и отправляет его на URL провайдера. Провайдер выполняет запрос на своей ноде и возвращает результат.

Примеры провайдеров:
- PublicNode (ethereum-rpc.publicnode.com) — бесплатный, без ключа, без гарантий.
- Infura (mainnet.infura.io/v3/<KEY>) — коммерческий, стабильный, с лимитами.
- Alchemy (eth-mainnet.g.alchemy.com/v2/<KEY>) — коммерческий, стабильный, с лимитами.
- Grove (Pocket Network) — раньше был популярен, но в 2026 году закрылся, домены rpc.grove.city больше не резолвятся.

Проблема не в самих провайдерах. Проблема в том, как status-go управляет списком этих провайдеров.


## 2. Как status-go устроен внутри (и почему это сложно)

Status-go прошёл долгий путь эволюции: с 2017 года он был Ethereum-нодой для DApp-браузера, потом стал мессенджером (2018–2020), а кошелёк добавился только в 2021+. Каждый новый слой «приклеивался» к старому ядру, которое не предполагало ни мультичейна, ни пользовательских провайдеров, ни L2.

### 2.1. Наследие: Network с шестью полями для URL

Структура params.Network исторически содержала шесть полей для URL провайдеров:

DefaultRPCURL       string // Deprecated: proxy rpc url
DefaultFallbackURL  string // Deprecated: proxy fallback url
DefaultFallbackURL2 string // Deprecated: second proxy fallback url
RPCURL              string // Deprecated: direct rpc url
OriginalRPCURL      string // Deprecated: direct rpc url if user overrides RPCURL
FallbackURL         string // Deprecated
OriginalFallbackURL string // Deprecated

Все они помечены как Deprecated в новых PR, но до сих пор используются. Разработчики сами признают: «It's not clear why we need OriginalRPCURL, OriginalFallbackURL in this datatype… Provider priority is implicit and not flexible».

Каждое новое требование (proxy, fallback, прямой провайдер) добавляло ещё одно поле, вместо того чтобы переписать структуру.

### 2.2. setRPCs: подстановка токенов по строковому совпадению

Функция setRPCs в default_networks.go берёт список сетей и WalletSecretsConfig (токены Infura/Alchemy/Grove, переданные при логине) и «вклеивает» токены в URL провайдеров. Но делает это через поиск подстроки:

authTokens := map[string]string{
    "infura.io":  request.InfuraToken,
    "grove.city": request.PoktToken,
}

Разработчик status-go прямо пишет в issue: «setRPCs relies on string comparison in URLs which is unreliable». И добавляет: «We have more than 10 API tokens configurable in WalletSecretConfig and only 3 of them are actually respected by the setRPCs function. It would be great to have other providers available for RPC calls. For example, the Alchemy».

То есть твой Alchemy-ключ игнорируется, потому что в authTokens его просто нет. А Infura-ключ подставляется только в те URL, которые содержат "infura.io".

### 2.3. getClientUsingCache: кэш навсегда

Функция getClientUsingCache в internal/rpc/client.go держит map[chainID]Client и не инвалидирует его при изменении провайдеров. Разработчик в issue #5937 называет это «outdated mechanisms rudiments in rpc/client.go that were added 7 years ago».

Это ключевой баг. Когда status-go впервые обращается к сети (например, при старте messenger или фонового refresher'а балансов), он создаёт RPC-клиент, собирая его из провайдеров, которые были в БД на тот момент. Если в этот момент там был только мёртвый direct-grove, клиент навсегда запомнит grove.city. Даже если потом ты добавишь stauri-rpc через networks_setChainUserRpcProviders, клиент его уже не увидит — до перезапуска ноды.

### 2.4. Встроенные провайдеры умерли, а конфиг остался

В default_networks.go до сих пор прописаны direct-grove с URL https://<chain>.rpc.grove.city/v1/. Но Grove закрылся в 2026 году, и эти домены больше не резолвятся. В твоём healthStatus это видно: dial tcp: lookup eth.rpc.grove.city: no such host (366 ошибок из 367 запросов для chainId 1).

direct-infura работает лучше (1 успешный запрос для chainId 1), но для L2 (Optimism) упирается в context deadline exceeded — потому что тариф Infura не покрывает эти сети или ключ не тот.

### 2.5. Итог: почему возникает твой баг

Ты добавил stauri-rpc (локальный форвардер) в конфиг. Он есть в networks_getFlatEthereumChains с enabled: true. Но status-go не ходит через него, потому что:

1. RPC-клиент для каждой сети был создан раньше, чем stauri-rpc попал в БД.
2. getClientUsingCache не инвалидирует кэш при изменении провайдеров.
3. Поэтому клиент продолжает использовать direct-grove (мёртвый) и direct-infura (частично рабочий), игнорируя твой stauri-rpc.

Это не ошибка Stauri. Это архитектурный долг status-go, который разработчики признают, но не чинят.


## 3. Что предлагают сами разработчики status-go

В issue #5933 и #5937 (открыты в 2024–2025) разработчики status-go предлагают конкретный рефакторинг:

1. Вынести провайдеров из Network в отдельный тип ProviderConfig с отношением «один ко многим» (Network → *ProviderConfig).
2. Явный приоритет провайдеров (сейчас приоритет неявный и зависит от порядка полей в структуре).
3. Разные токены для разных chainID (сейчас один токен на всех).
4. Использовать всех доступных провайдеров в circuit breaker (сейчас fallback работает непредсказуемо).

Часть этого уже сделана: в PR #6151 добавлена таблица rpc_providers и тип RpcProvider с полями type (user/embedded), authType, enabled. Но интеграция с getClientUsingCache не завершена, и кэш по-прежнему не инвалидируется.

Разработчик friofry в комментарии к issue пишет: «Removing both rps_limiter and circuit_breaker and moving the provider logic to the proxy sounds better. (Basically, this is what the proxy design pattern means)». То есть они сами склоняются к тому, что логику fallback/health-check нужно вынести из status-go в отдельный прокси-слой. Твой локальный форвардер stauri-rpc — это ровно то, что они предлагают, но реализованное на стороне клиента.


## 4. Перспективы решения

### Вариант A: Перезапуск ноды после configureWalletRpc

Самый надёжный, но тяжёлый. После того как stauri-rpc прописан, нужно остановить и заново запустить ноду (stop_backend + start_backend), чтобы RPC-клиенты собрались заново — уже с stauri-rpc. Это гарантированно сработает, потому что кэш будет пуст при старте.

Минус: меняет архитектуру (нода перезапускается после логина, что необычно).

### Вариант B: Прописать stauri-rpc до первого RPC-клиента

Первый RPC-клиент создаётся, когда status-go впервые обращается к сети. Это может быть:
- messenger при старте;
- фоновый refresher балансов при wallet_startWallet;
- loginAccount (проверка сети).

Если configureWalletRpc вызывается до любого из этих обращений, клиент соберётся с stauri-rpc. Проблема в том, что networks_* сервис становится доступен только после initializeApplication, а loginAccount может создать клиент раньше, чем ты успеешь прописать провайдера.

Нужно проверить, в какой момент networks_* становится доступен, и вызвать configureWalletRpc сразу после этого — до loginAccount.

### Вариант C: Патч status-go (не рекомендуется)

Добавить в default_networks.go прямой Infura-провайдер с directURL: "https://mainnet.infura.io/v3/" и убедиться, что setRPCs подставляет InfuraToken. Это ~10 строк Go, пересборка sidecar. Но это симптоматическое лечение: кэш всё равно не инвалидируется, и при следующем изменении провайдеров баг вернётся.

Разработчики status-go сами говорят, что правильное решение — рефакторинг (вынос провайдеров в отдельный тип + инвалидация кэша), а не заплатки.


## 5. Краткая сводка

| Вопрос | Ответ |
|---|---|
| Что делает провайдер? | Посредник между приложением и блокчейном. Принимает JSON-RPC запрос, выполняет на своей ноде, возвращает результат. |
| Почему status-go сложен? | Эволюция из Ethereum-ноды (2017) в мессенджер (2018) и кошелёк (2021+). Слои не переписаны. |
| Почему stauri-rpc не работает? | getClientUsingCache кэширует RPC-клиент навсегда. Клиент собран до того, как stauri-rpc попал в БД. |
| Почему Alchemy игнорируется? | setRPCs ищет подстроку "infura" или "grove" в URL. Alchemy в списке нет. |
| Почему Grove не работает? | Grove закрылся в 2026, домены rpc.grove.city не резолвятся. |
| Что делать? | Либо перезапустить ноду после configureWalletRpc, либо прописать stauri-rpc до первого RPC-клиента. |
| Это болезнь роста? | Нет. Это архитектурный долг зрелого проекта, который не рефакторил ядро вовремя. Разработчики знают о проблеме, но переписать руки не дошли. |
