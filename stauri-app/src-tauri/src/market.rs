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
pub async fn fetch_market_data() -> Result<Vec<MarketCoin>, String> {
    // 1. Проверяем кэш
    if let Ok(guard) = CACHE.lock() {
        if let Some(entry) = &*guard {
            if entry.fetched_at.elapsed() < CACHE_TTL {
                return Ok(entry.data.clone());
            }
        }
    }

    // 2. Ключ из .env
    let api_key = std::env::var("COINGECKO_KEY").unwrap_or_default();
    if api_key.is_empty() {
        return Err("COINGECKO_KEY не задан в .env".to_string());
    }

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
        .map_err(|e| format!("Client build error: {e}"))?;

    let resp = client
        .get(url)
        .header("Accept", "application/json")
        .header("x-cg-demo-api-key", api_key)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "CoinGecko HTTP {}: {}",
            status,
            body.chars().take(300).collect::<String>()
        ));
    }

    // 4. Читаем тело (для диагностики при ошибке парсинга)
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Body read error: {e}"))?;

    let data: Vec<MarketCoin> = serde_json::from_str(&body).map_err(|e| {
        format!(
            "JSON parse error: {e}\nBody (first 500): {}",
            body.chars().take(500).collect::<String>()
        )
    })?;

    // 5. Сохраняем в кэш
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some(CacheEntry {
            data: data.clone(),
            fetched_at: Instant::now(),
        });
    }

    Ok(data)
}
