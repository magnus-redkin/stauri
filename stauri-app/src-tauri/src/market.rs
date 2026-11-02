use crate::error::{AppError, AppResult};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketCoin {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub image: String,
    pub current_price: f64,
    pub market_cap: f64,
    pub total_volume: f64,
    #[serde(default)]
    pub price_change_percentage_24h: Option<f64>,
}

struct CacheEntry {
    data: Vec<MarketCoin>,
    fetched_at: Instant,
}

static CACHE: Lazy<Mutex<Option<CacheEntry>>> = Lazy::new(|| Mutex::new(None));
const CACHE_TTL: Duration = Duration::from_secs(60);

#[tauri::command]
pub async fn fetch_market_data() -> AppResult<Vec<MarketCoin>> {
    // 1. Проверяем кэш
    if let Ok(guard) = CACHE.lock()
        && let Some(entry) = &*guard
        && entry.fetched_at.elapsed() < CACHE_TTL
    {
        return Ok(entry.data.clone());
    }

    // 2. Ключ CoinGecko — необязателен.
    //
    //    Публичный эндпоинт отдаёт данные без ключа; x-cg-demo-api-key только
    //    повышает лимит запросов. При кэше в 60 с и одном запросе на 50 монет
    //    анонимного лимита хватает, поэтому отсутствие ключа — не ошибка.
    //    Ключ читается из ~/.config/com.magnus.stauri-app/.env (см. load_env).
    let api_key = std::env::var("COINGECKO_KEY").unwrap_or_default();

    let url = "https://api.coingecko.com/api/v3/coins/markets\
        ?vs_currency=usd\
        &order=market_cap_desc\
        &per_page=50\
        &page=1\
        &price_change_percentage=24h";

    // 3. Запрос
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::internal(format!("client build error: {e}")))?;

    let mut request = client.get(url).header("Accept", "application/json");
    if !api_key.is_empty() {
        request = request.header("x-cg-demo-api-key", &api_key);
    }

    let resp = request
        .send()
        .await
        .map_err(|e| AppError::network(format!("request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        // Тело ответа не включаем: оно может содержать служебные данные.
        return Err(AppError::network(format!(
            "CoinGecko HTTP {status} ({} bytes)",
            body.len()
        )));
    }

    // 4. Читаем тело (для диагностики при ошибке парсинга)
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::network(format!("body read error: {e}")))?;

    let data: Vec<MarketCoin> = serde_json::from_str(&body)
        .map_err(|e| AppError::network(format!("JSON parse error: {e}")))?;

    // 5. Сохраняем в кэш
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some(CacheEntry {
            data: data.clone(),
            fetched_at: Instant::now(),
        });
    }

    Ok(data)
}
