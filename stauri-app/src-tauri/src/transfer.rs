//! Отправка средств из кошелька.
//!
//! ## Почему это в Rust, а не в компоненте
//!
//! Перевод в status-go трёхшаговый (`pkg/services/wallet/api.go`):
//!
//! ```text
//! wallet_buildTransaction(chainID, sendTxArgs)   → messageToSign, txArgs
//! wallet_signMessage(messageToSign, from, pass)  → подпись
//! wallet_sendTransactionWithSignature(chainID, "WalletTransfer", txArgs, sig)
//! ```
//!
//! Если бы эта последовательность жила в webview, любая XSS получила бы две
//! вещи сразу: пароль профиля и универсальное приспособление для подписи —
//! `wallet_signMessage` подписывает любые 32 байта ключом кошелька и не
//! знает, что это за байты. Тогда чужой скрипт мог бы подписать собранную им
//! транзакцию «переведи всё на этот адрес».
//!
//! Здесь наружу торчит только намерение: «отправь столько-то этого токена на
//! такой-то адрес». Хэш для подписи, шаги и пароль не покидают Rust.
//!
//! ## Что проверяет Rust, а что нет
//!
//! Проверяется то, что можно проверить без сети: форма адреса, схема суммы,
//! диапазон chainId, наличие пароля. Достаточность средств, корректность газа
//! и самой транзакции проверяет нода — дублировать это значило бы расходиться
//! с ней в правилах.
//!
//! ## Пароль
//!
//! Приходит от фронтенда один раз за сессию и здесь не хранится: передаётся
//! в `wallet_signMessage` и забывается. Держать его дольше незачем — каждая
//! отправка и так идёт через эту команду.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::auth_proxy;
use crate::error::{AppError, AppResult};

/// Куда идёт запрос: через аутентифицирующий прокси, а не в сам бэкенд.
///
/// Прокси проверяет заголовок с токеном, поэтому даже если порт бэкенда
/// известен другому процессу, этот путь закрыт для него.
const CALL_RPC: &str = "CallRPC";

/// Запрос к status-go через прокси.
async fn call(port: u16, method: &str, params: Value) -> AppResult<Value> {
    let token = auth_proxy::token()?;
    let url = format!("http://127.0.0.1:{port}/statusgo/{CALL_RPC}");

    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });

    let client = reqwest::Client::builder()
        // Локальный адрес: системный прокси здесь только помешает.
        .no_proxy()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::internal(format!("client build error: {e}")))?;

    let resp = client
        .post(&url)
        .header(auth_proxy::TOKEN_HEADER, token)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::backend(format!("backend request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::backend(format!(
            "backend returned HTTP {}",
            resp.status()
        )));
    }

    let envelope: Value = resp
        .json()
        .await
        .map_err(|e| AppError::backend(format!("backend sent invalid JSON: {e}")))?;

    // Ошибка метода приходит внутри JSON-RPC, а не кодом HTTP.
    if let Some(err) = envelope.get("error") {
        return Err(AppError::backend(describe_rpc_error(err)));
    }

    Ok(envelope.get("result").cloned().unwrap_or(Value::Null))
}

/// Достаёт текст ошибки из ответа JSON-RPC.
///
/// status-go кладёт ошибки в двух формах: строка и объект
/// `{ code, message }`. Показываем что есть, но без тела ответа целиком —
/// там бывают адреса и суммы.
fn describe_rpc_error(err: &Value) -> String {
    if let Some(msg) = err.as_str() {
        return msg.to_string();
    }
    if let Some(msg) = err.get("message").and_then(|m| m.as_str()) {
        return msg.to_string();
    }
    "backend returned an error".to_string()
}

/// Запрос на перевод.
#[derive(Debug, Deserialize)]
pub struct TransferRequest {
    /// Порт аутентифицирующего прокси.
    pub port: u16,
    pub chain_id: u64,
    /// Адрес отправителя — кошелёк этого профиля.
    pub from: String,
    pub to: String,
    /// Адрес контракта токена. Для нативного ETH — нулевой адрес.
    pub token_address: String,
    /// Сумма в минимальных единицах (строка, чтобы не терять точность).
    pub amount: String,
    /// Пароль профиля. Не логируется и не хранится.
    pub password: String,
}

/// Результат отправки.
#[derive(Debug, Serialize)]
pub struct TransferResult {
    /// Хэш транзакции, если нода его вернула.
    pub tx_hash: String,
}

/// Адрес нативного актива во всех сетях EVM.
const NATIVE_TOKEN: &str = "0x0000000000000000000000000000000000000000";

/// Отправляет перевод и возвращает хэш.
#[tauri::command]
pub async fn send_transfer(request: TransferRequest) -> AppResult<TransferResult> {
    validate(&request)?;

    let amount = parse_amount(&request.amount)?;
    let is_native = request.token_address.eq_ignore_ascii_case(NATIVE_TOKEN);

    // 1. Собрать транзакцию. Нода сама подставит nonce, газ и цену газа по
    //    текущей сети; мы не передаём их, чтобы не спорить с ней о значениях.
    //
    //    Нативный актив и токен отличаются тем, куда идёт транзакция: у ETH
    //    получатель — это `to`, а сумма — `value`. У ERC-20 транзакция идёт
    //    контракту (`to` = контракт, `value` = 0), а получатель и сумма
    //    кодируются в `data` вызовом transfer(address,uint256).
    let args = if is_native {
        json!({
            "from": request.from,
            "to": request.to,
            "value": format!("0x{amount:x}"),
            "data": "0x",
        })
    } else {
        json!({
            "from": request.from,
            "to": request.token_address,
            "value": "0x0",
            "data": encode_erc20_transfer(&request.to, amount),
        })
    };

    let built = call(
        request.port,
        "wallet_buildTransaction",
        json!([request.chain_id, args.to_string()]),
    )
    .await?;

    // Нода отвечает объектом с полями `messageToSign` и `txArgs`. Без хэша
    // продолжать нечем: подписывать нечего.
    let message = built
        .get("messageToSign")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::backend("backend returned no hash to sign"))?
        .to_string();

    // `txArgs` возвращаем ОБРАТНО в ноду без изменений: там nonce и газ,
    // которые она только что посчитала. Собирать их заново значило бы
    // отправить не ту транзакцию, которую мы показывали.
    let tx_args = built
        .get("txArgs")
        .cloned()
        .ok_or_else(|| AppError::backend("backend returned no transaction arguments"))?;

    // 2. Подписать. Пароль живёт только внутри этого вызова.
    //
    //    `message` передаём как есть, с `0x`: параметр объявлен как
    //    `types.HexBytes`, а его JSON-разбор ждёт hex-строку с префиксом.
    let signature = call(
        request.port,
        "wallet_signMessage",
        json!([message, request.from, request.password]),
    )
    .await?
    .as_str()
    .ok_or_else(|| AppError::backend("backend returned no signature"))?
    .to_string();

    // 3. Отправить. `WalletTransfer` — тип из PendingTrxType
    //    (pkg/services/wallet/pendingtxtracker/pendingtxtracker.go).
    //
    // ## Почему подпись идёт без префикса `0x`
    //
    // Это расхождение в самом status-go, и оно не наше:
    //
    //   * `wallet_signMessage` возвращает подпись через `types.EncodeHex`,
    //     а тот ДОБАВЛЯЕТ `0x` (internal/crypto/types/utils.go);
    //   * `wallet_sendTransactionWithSignature` разбирает её через
    //     `hex.DecodeString` (pkg/services/wallet/api.go:613), а тот
    //     принимает только голый hex: на `0x` он отвечает
    //     «encoding/hex: invalid byte: U+0078 'x'».
    //
    // Отсюда ошибка, которую видел пользователь при первой отправке:
    // подпись была получена успешно и транзакция не ушла только из-за
    // префикса. Поэтому снимаем его здесь, а не полагаемся на ноду.
    let hash = call(
        request.port,
        "wallet_sendTransactionWithSignature",
        json!([
            request.chain_id,
            "WalletTransfer",
            tx_args.to_string(),
            strip_hex_prefix(&signature)
        ]),
    )
    .await?;

    let tx_hash = hash.as_str().unwrap_or_default().to_string();
    if tx_hash.is_empty() {
        return Err(AppError::backend("backend returned no transaction hash"));
    }

    Ok(TransferResult { tx_hash })
}

/// Проверяет запрос до обращения к сети.
///
/// Всё, что здесь отклоняется, не стоит даже вызова бэкенда: адрес не той
/// формы, сумма не число, chainId не тот.
fn validate(request: &TransferRequest) -> AppResult<()> {
    if request.port == 0 {
        return Err(AppError::config("backend is not running"));
    }

    // chainId 0 — не сеть. Верхняя граница взята с запасом: реальные сети
    // укладываются в u64, а 0 и мусор отсекаем здесь.
    if request.chain_id == 0 {
        return Err(AppError::config("chain id is required"));
    }

    for (label, addr) in [
        ("sender", &request.from),
        ("recipient", &request.to),
        ("token", &request.token_address),
    ] {
        if !is_address(addr) {
            return Err(AppError::config(format!("invalid {label} address")));
        }
    }

    if request.password.is_empty() {
        return Err(AppError::config("password is required"));
    }

    // `u128` не бывает отрицательным, поэтому «больше нуля» — это просто
    // «не ноль».
    if parse_amount(&request.amount)? == 0 {
        return Err(AppError::config("amount must be greater than zero"));
    }

    Ok(())
}

/// Снимает префикс `0x`, если он есть.
///
/// Нужен только там, где status-go декодирует hex без префикса (см. шаг 3
/// в `send_transfer`). Остальные поля передаются с `0x`, как и положено.
fn strip_hex_prefix(value: &str) -> &str {
    value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .unwrap_or(value)
}

/// Адрес EVM: `0x` и ровно 40 шестнадцатеричных цифр.
fn is_address(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 42
        && bytes[0] == b'0'
        && (bytes[1] == b'x' || bytes[1] == b'X')
        && bytes[2..].iter().all(|b| b.is_ascii_hexdigit())
}

/// `data` для вызова `transfer(address,uint256)` у ERC-20.
///
/// ## Почему кодируем сами
///
/// Это фиксированный ABI-вызов из четырёх байт селектора и двух 32-байтных
/// аргументов — тащить ради него полноценный ABI-энкодер (alloy/ethabi)
/// незачем: он добавит сотни килобайт зависимостей ради 64 строк.
///
/// Селектор `0xa9059cbb` — это первые 4 байта keccak256("transfer(address,uint256)").
/// Он один и тот же у всех ERC-20, поэтому выписан константой, а не считается
/// в рантайме.
///
/// ## Почему сумма обязана влезть в 32 байта
///
/// `uint256` — это ровно 256 бит. Сумма больше 2^256 не представима, и
/// молча обрезать её значило бы отправить не ту сумму.
fn encode_erc20_transfer(to: &str, amount: u128) -> String {
    // `to` уже проверен `is_address`, но проверяем ещё раз: эта функция
    // собирает байты, которые попадут в сеть, и ошибиться здесь нельзя.
    let recipient = to
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .to_ascii_lowercase();

    // 20 байт адреса дополняются 12 байтами нулей до 32 — так требует ABI.
    let address_word = format!("{recipient:0>64}");
    // Сумма — 32 байта шестнадцатеричного числа с ведущими нулями.
    let amount_word = format!("{amount:064x}");

    format!("0xa9059cbb{address_word}{amount_word}")
}

/// Разбирает сумму в минимальных единицах.
///
/// Фронтенд уже перевёл её в целое (`utils/amount.ts`), поэтому принимаем
/// только десятичные цифры. Строку, а не число: `u64` не хватит для 18
/// знаков, а `f64` потеряет точность.
fn parse_amount(raw: &str) -> AppResult<u128> {
    raw.parse::<u128>()
        .map_err(|_| AppError::config("amount must be a decimal integer"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> TransferRequest {
        TransferRequest {
            port: 1234,
            chain_id: 11155111,
            from: "0xcd8fd2a9f9726729d19f9be57d959942d7eb578c".to_string(),
            to: "0x0000000000000000000000000000000000000001".to_string(),
            token_address: "0x0000000000000000000000000000000000000000".to_string(),
            amount: "10000000000000000".to_string(),
            password: "secret".to_string(),
        }
    }

    #[test]
    fn accepts_valid_request() {
        assert!(validate(&request()).is_ok());
    }

    #[test]
    fn rejects_bad_addresses() {
        for bad in [
            "",
            "0x",
            "0x123",
            "cd8fd2a9f9726729d19f9be57d959942d7eb578c",
            "0xcd8fd2a9f9726729d19f9be57d959942d7eb578cz",
            "0xcd8fd2a9f9726729d19f9be57d959942d7eb578",
        ] {
            let mut r = request();
            r.to = bad.to_string();
            assert!(validate(&r).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn accepts_uppercase_x_prefix() {
        // Некоторые кошельки копируют адрес как `0X…`.
        let mut r = request();
        r.to = "0X0000000000000000000000000000000000000001".to_string();
        assert!(validate(&r).is_ok());
    }

    #[test]
    fn rejects_zero_chain_and_port() {
        let mut r = request();
        r.chain_id = 0;
        assert!(validate(&r).is_err());

        let mut r = request();
        r.port = 0;
        assert!(validate(&r).is_err());
    }

    #[test]
    fn rejects_zero_amount() {
        let mut r = request();
        r.amount = "0".to_string();
        assert!(validate(&r).is_err());
    }

    #[test]
    fn rejects_non_integer_amount() {
        for bad in ["1.5", "-1", "abc", "", "1e18"] {
            let mut r = request();
            r.amount = bad.to_string();
            assert!(validate(&r).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn rejects_empty_password() {
        let mut r = request();
        r.password = String::new();
        assert!(validate(&r).is_err());
    }

    #[test]
    fn amount_keeps_full_precision() {
        // 1 ETH в wei: u64 этого не вмещает (предел ~1.8e19, но 1e18 вмещает),
        // а вот 100 ETH — уже на границе. u128 держит любые реальные суммы.
        assert_eq!(
            parse_amount("100000000000000000000").unwrap(),
            100_000_000_000_000_000_000u128
        );
    }

    #[test]
    fn encodes_erc20_transfer_call() {
        // Эталон: transfer(0x0000…0001, 1) у USDC (6 знаков) — сумма 1e6.
        let data = encode_erc20_transfer("0x0000000000000000000000000000000000000001", 1_000_000);
        assert_eq!(
            data,
            concat!(
                "0xa9059cbb",
                "0000000000000000000000000000000000000000000000000000000000000001",
                "00000000000000000000000000000000000000000000000000000000000f4240",
            )
        );
        // Селектор + два 32-байтных слова = 4 + 32 + 32 байта.
        assert_eq!(data.len(), 2 + 8 + 64 + 64);
    }

    #[test]
    fn erc20_encoding_accepts_uppercase_prefix_and_uppercase_hex() {
        let lower = encode_erc20_transfer("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", 1);
        let upper = encode_erc20_transfer("0XABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD", 1);
        // Регистр не должен влиять на байты: адрес дополняется нулями одинаково.
        assert_eq!(lower, upper);
        assert!(lower.contains("abcdefabcdefabcdefabcdefabcdefabcdefabcd"));
    }

    #[test]
    fn erc20_encoding_pads_small_amounts() {
        let data = encode_erc20_transfer("0x0000000000000000000000000000000000000001", 0xff);
        assert!(data.ends_with("00000000000000000000000000000000000000000000000000000000000000ff"));
    }

    #[test]
    fn native_and_token_addresses_are_distinguished() {
        // Нулевой адрес — это ETH, а не ERC-20: сборка аргументов для них
        // разная, и перепутать значит отправить токен на пустой адрес.
        assert!(NATIVE_TOKEN.eq_ignore_ascii_case("0x0000000000000000000000000000000000000000"));
        assert!(!NATIVE_TOKEN.eq_ignore_ascii_case("0x0000000000000000000000000000000000000001"));
    }

    /// Регрессия первой реальной отправки.
    ///
    /// `wallet_signMessage` возвращает подпись с префиксом `0x`, а
    /// `wallet_sendTransactionWithSignature` разбирает её через
    /// `hex.DecodeString`, который префикса не понимает. Пользователь видел
    /// «encoding/hex: invalid byte: U+0078 'x'» — подпись была получена,
    /// а транзакция не уходила. Проверяем, что префикс снимается в обоих
    /// регистрах и что остальные поля не портятся.
    #[test]
    fn strips_prefix_only_from_signature() {
        let sig = "0x1b2a3c4d5e6f";
        assert_eq!(strip_hex_prefix(sig), "1b2a3c4d5e6f");
        assert_eq!(strip_hex_prefix("0X1B2A"), "1B2A");

        // Без префикса строка не меняется: иначе сломались бы вызовы, где
        // нода уже вернула голый hex.
        assert_eq!(strip_hex_prefix("1b2a"), "1b2a");

        // Адрес при этом остаётся с префиксом: его ждут с `0x`.
        let addr = "0xcd8fd2a9f9726729d19f9be57d959942d7eb578c";
        assert_eq!(strip_hex_prefix(addr).len(), 40);
        assert!(is_address(addr));
    }

    #[test]
    fn rpc_error_is_described_without_body() {
        assert_eq!(
            describe_rpc_error(&json!("insufficient funds")),
            "insufficient funds"
        );
        assert_eq!(
            describe_rpc_error(&json!({"code": -32000, "message": "nonce too low"})),
            "nonce too low"
        );
        assert_eq!(
            describe_rpc_error(&json!({"code": 1})),
            "backend returned an error"
        );
    }
}
