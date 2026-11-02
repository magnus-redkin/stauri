//! Конфигурация сети: определение, загрузка и валидация.
//!
//! Источники, в порядке приоритета: `STAURI_NETWORK`, `STAURI_CONFIG_PATH`,
//! `~/.config/stauri/config.json`, встроенный дефолт (mainnet).

use std::path::PathBuf;

use serde::Deserialize;

use crate::error::{AppError, AppResult};

#[derive(Deserialize, Default, Debug)]
pub struct AppConfig {
    ethereum: Option<EthereumConfig>,
    waku: Option<WakuConfig>,
}

#[derive(Deserialize, Default, Debug)]
pub struct EthereumConfig {
    preset: Option<String>,
    #[serde(default = "default_chain_id")]
    chain_id: u64,
    rpc_url: Option<String>,
}

#[derive(Deserialize, Default, Debug)]
pub struct WakuConfig {
    fleet: Option<String>,
}

fn default_chain_id() -> u64 {
    1
}

impl AppConfig {
    pub fn network_name(&self) -> String {
        self.ethereum
            .as_ref()
            .and_then(|e| e.preset.clone())
            .unwrap_or_else(|| "mainnet".to_string())
    }

    pub fn chain_id(&self) -> u64 {
        self.ethereum.as_ref().map(|e| e.chain_id).unwrap_or(1)
    }

    pub fn rpc_url(&self) -> String {
        self.ethereum
            .as_ref()
            .and_then(|e| e.rpc_url.clone())
            .unwrap_or_else(|| default_rpc_url(&self.network_name()))
    }

    pub fn waku_fleet(&self) -> String {
        self.waku
            .as_ref()
            .and_then(|w| w.fleet.clone())
            .unwrap_or_else(|| "status.prod".to_string())
    }

    pub fn is_testnet(&self) -> bool {
        self.network_name() != "mainnet"
    }

    pub fn data_dir_suffix(&self) -> PathBuf {
        PathBuf::from(self.network_name())
    }
}

pub fn default_rpc_url(network: &str) -> String {
    match network {
        "sepolia" => "https://rpc.sepolia.org".to_string(),
        "holesky" => "https://ethereum-holesky-rpc.publicnode.com".to_string(),
        _ => "https://ethereum-rpc.publicnode.com".to_string(),
    }
}

/// Белый список сетей: (имя, chain_id, waku_fleet).
pub const NETWORKS: &[(&str, u64, &str)] = &[
    ("mainnet", 1, "status.prod"),
    ("sepolia", 11155111, "status.test"),
    ("holesky", 17000, "status.test"),
];

pub fn config_for_network(network: &str) -> AppResult<AppConfig> {
    let (name, chain_id, fleet) =
        NETWORKS
            .iter()
            .find(|(n, _, _)| *n == network)
            .ok_or_else(|| {
                AppError::config(format!(
                    "unknown network: {network}. Allowed: mainnet, sepolia, holesky"
                ))
            })?;

    let rpc_url = default_rpc_url(name);

    Ok(AppConfig {
        ethereum: Some(EthereumConfig {
            preset: Some(network.to_string()),
            chain_id: *chain_id,
            rpc_url: Some(rpc_url),
        }),
        waku: Some(WakuConfig {
            fleet: Some(fleet.to_string()),
        }),
    })
}

/// Проверяет, что preset из файла входит в белый список.
fn validate_preset(config: &AppConfig) -> Option<AppConfig> {
    if let Some(ref eth) = config.ethereum
        && let Some(ref preset) = eth.preset
        && !NETWORKS.iter().any(|(n, _, _)| *n == preset)
    {
        tracing::warn!(
            preset = %preset,
            "invalid preset in config.json, falling back to mainnet"
        );
        return Some(AppConfig::default());
    }
    None
}

pub fn load_config() -> AppConfig {
    // 1. STAURI_NETWORK (только из белого списка)
    if let Ok(network) = std::env::var("STAURI_NETWORK") {
        match config_for_network(&network) {
            Ok(config) => return config,
            Err(e) => tracing::warn!(
                error = %e.message,
                "invalid STAURI_NETWORK, falling back to mainnet"
            ),
        }
    }

    // 2. STAURI_CONFIG_PATH
    if let Ok(path) = std::env::var("STAURI_CONFIG_PATH")
        && let Ok(content) = std::fs::read_to_string(&path)
        && let Ok(config) = serde_json::from_str::<AppConfig>(&content)
    {
        return validate_preset(&config).unwrap_or(config);
    }

    // 3. ~/.config/stauri/config.json
    if let Some(config_dir) = dirs::config_dir() {
        let config_path = config_dir.join("stauri").join("config.json");
        if let Ok(content) = std::fs::read_to_string(&config_path)
            && let Ok(config) = serde_json::from_str::<AppConfig>(&content)
        {
            return validate_preset(&config).unwrap_or(config);
        }
    }

    // 4. Дефолт (Mainnet)
    AppConfig::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_rpc_url_sepolia() {
        assert_eq!(default_rpc_url("sepolia"), "https://rpc.sepolia.org");
    }

    #[test]
    fn test_default_rpc_url_holesky() {
        assert_eq!(
            default_rpc_url("holesky"),
            "https://ethereum-holesky-rpc.publicnode.com"
        );
    }

    #[test]
    fn test_default_rpc_url_fallback() {
        assert_eq!(
            default_rpc_url("mainnet"),
            "https://ethereum-rpc.publicnode.com"
        );
        assert_eq!(
            default_rpc_url("unknown_network"),
            "https://ethereum-rpc.publicnode.com"
        );
    }

    #[test]
    fn test_config_for_network_sepolia() {
        let config = config_for_network("sepolia").unwrap();
        assert_eq!(config.network_name(), "sepolia");
        assert_eq!(config.chain_id(), 11155111);
        assert_eq!(config.waku_fleet(), "status.test");
        assert!(config.is_testnet());
    }

    #[test]
    fn test_config_for_network_mainnet() {
        let config = config_for_network("mainnet").unwrap();
        assert_eq!(config.network_name(), "mainnet");
        assert_eq!(config.chain_id(), 1);
        assert_eq!(config.waku_fleet(), "status.prod");
        assert!(!config.is_testnet());
    }

    #[test]
    fn test_config_for_network_invalid() {
        let err = config_for_network("../../x").expect_err("unknown network must fail");
        assert_eq!(err.kind, crate::error::ErrorKind::Config);
        assert!(err.message.contains("unknown network"), "{}", err.message);
    }

    #[test]
    fn test_app_config_defaults() {
        let config = AppConfig::default();
        assert_eq!(config.network_name(), "mainnet");
        assert_eq!(config.chain_id(), 1);
        assert_eq!(config.rpc_url(), "https://ethereum-rpc.publicnode.com");
        assert_eq!(config.waku_fleet(), "status.prod");
        assert!(!config.is_testnet());
        // data_dir_suffix всегда возвращает имя сети, включая mainnet:
        // иначе каталоги mainnet и тестнетов смешиваются в одном месте.
        assert_eq!(config.data_dir_suffix(), PathBuf::from("mainnet"));
    }

    #[test]
    fn test_app_config_custom() {
        let config = AppConfig {
            ethereum: Some(EthereumConfig {
                preset: Some("sepolia".to_string()),
                chain_id: 11155111,
                rpc_url: Some("https://custom.rpc".to_string()),
            }),
            waku: Some(WakuConfig {
                fleet: Some("custom.fleet".to_string()),
            }),
        };
        assert_eq!(config.network_name(), "sepolia");
        assert_eq!(config.chain_id(), 11155111);
        assert_eq!(config.rpc_url(), "https://custom.rpc");
        assert_eq!(config.waku_fleet(), "custom.fleet");
        assert!(config.is_testnet());
        assert_eq!(config.data_dir_suffix(), PathBuf::from("sepolia"));
    }
}
