# Stauri (Status client on Tauri)

[`README_ru.md`](README_ru.md)

**Stauri** is a lightweight desktop client for the Status ecosystem, being developed as an actively growing alternative to the official `status-desktop`.

Built on **Tauri (Rust)** and **Svelte 5**, Stauri uses a sidecar architecture to talk to the Status backend (`status-backend`) over local WebSocket and HTTP. This approach preserves the full power of `status-go` while providing a modern, fast, and flexible user interface.

## ✨ Expected advantages over `status-desktop`

- **Modern stack (Svelte 5 + Tailwind CSS):** Provides a faster and more responsive UI compared to the Nim/QML stack, significantly improving development speed and usability.
- **Modular architecture:** Clear separation of responsibilities (Chat, Wallet, dApp browser). This simplifies maintenance of the codebase, its extension, and adaptation to new features.
- **Security through isolation:** dApps open in isolated Tauri WebView windows, reducing the attack surface compared to a monolithic QML application. A future update will add safe `window.ethereum` injection with granular permissions.
- **Native cross-platform support:** Tauri provides native support for Windows, macOS, and Linux "out of the box" with a minimal bundle size.
- **Extensibility by design:** The separation of UI and the Rust backend makes it easy to plug in custom extensions and features without touching the core of the Status protocol.

## ⚙️ Network configuration

By default, Stauri connects to **Ethereum Mainnet** and the **Production Waku fleet**. However, you can easily switch to testnets or use custom RPCs for development.

### 🛡️ Data isolation
To prevent data corruption, Stauri isolates network data. Mainnet uses the app's root data directory, while testnets create isolated subdirectories (e.g., `.../stauri/sepolia/`). Your Mainnet profiles and keys remain fully safe when testing on Sepolia.

### 🖥️ UI indication
When connected to a testnet, Stauri provides clear visual cues:
- An orange warning banner at the top of the app.
- Detailed network information (Network name, Chain ID, RPC URL, Waku Fleet) shown in the left sidebar under Profile.

## 📚 Documentation

- [`docs/en/architecture.md`](docs/en/architecture.md) — overall architecture, layers, data flow.
- [`docs/en/networks_and_balances.md`](docs/en/networks_and_balances.md) — path from balance to screen, RPC forwarder, `status-go` caches.
- [`docs/en/status_outdated_architecture.md`](docs/en/status_outdated_architecture.md) — why `status-go` is complex (RPC clients, providers).
- [`docs/en/tests.md`](docs/en/tests.md) — testing strategy (unit, component, E2E, manual checks).
- [`BUILDING.md`](BUILDING.md) — building `status-backend` in Nix and preparing the sidecar.

## 🧩 What is already implemented

### 💼 Wallet

The main wallet screen — 5 tabs: **Assets / Send / Receive / Buy / Swap**.

- **Assets** — token list grouped by `(symbol, chainGroup)`, where `chainGroup` = EVM (Ethereum, Optimism, Arbitrum, Base), BSC (Binance), or chainId. Icons come from `cryptocurrency-icons` (by symbol), with fallback to Trust Wallet Assets (by contract address) cached in `localStorage`, and a final fallback to the first letter. Zero balances are not discarded; `hasError` is shown as a label.
- **Send** — placeholder form (token, recipient, amount, Review). Router logic is in progress.
- **Receive** — address and QR code (via `api.qrserver.com`), with a "Copy" button.
- **Buy** — tab disabled (OnRamp to be added later).
- **Swap** — tab disabled (Router/Swap to be added later).

In the left column — account info (`All accounts`, token count, shortened address) and a **Manage accounts** link (Wallet icon + pencil).

### 📈 Market

A separate module that **does not depend on `status-go`**:

- `src-tauri/src/market.rs` — Tauri command `fetch_market_data`, which calls CoinGecko (`/coins/markets`) via `reqwest`, passes `x-cg-demo-api-key` from `.env`, and caches the response for 60 seconds.
- `MarketMain.svelte` — top-50 coin table (price, 24h, volume, market cap), icons from CoinGecko (`image` URL).
- The `COINGECKO_KEY` is read via `dotenv` on Rust startup. If missing — Market shows the error "COINGECKO_KEY is not set".

Why this way: `status-go` can return market data, but that pulls in a dependency on `market-proxy` and its caches. For Stauri it's simpler and cleaner to call CoinGecko directly from Rust.

### 💬 Chat and contacts

- Chat list (`ChatLeft`), message window (`ChatMain`), search, sending.
- Contacts (`ContactsLeft`, `ContactsMain`), adding by public key, accepting requests.
- Unread request badge in the sidebar.

### 🔐 Profile

- Account info (Profile ID, Public Key, Network, Chain ID, RPC, Waku Fleet).
- Profile editing (Display Name; ENS — deferred).
- Seed phrase creation and verification (placeholder, not wired to the backend).
- Disconnect.

### 🖥️ Settings

- Language: **English / Русский / 中文 / Español**.
- Theme: **Maroon / Light / Dark**.
- Font size (12–20 px).

### 🌐 dApp windows

`open_dapp_window` creates an isolated Tauri WebView window with an external URL. A future update will add safe `window.ethereum` injection with granular permissions.

## ⚠️ Known limitations and challenges

- **Nix build of `status-backend`:** the `status-backend` binary and `libsds.so` must be built **in the same Nix environment** (same glibc, same ABI). If `status-backend` is built with system Go and `libsds.so` is taken from the Nix store (or vice versa), `status-backend` crashes with `SIGSEGV` when loading `libsds.so`. See `BUILDING.md` for details.
- **`CGO_LDFLAGS`/`CGO_CFLAGS`:** local variables (vosk, whisper, portaudio, onnxruntime) inject system libraries (e.g., `libmp3lame` built against glibc 2.43) and break the Nix build. Before `make status-backend` in the Nix shell, run `unset CGO_LDFLAGS CGO_CFLAGS`.
- **Nix interpreter in `status-backend`:** the binaries carry a `/nix/store` `INTERP` and `RUNPATH`, so on a machine without that store `execve` fails with `ENOENT`. `release.sh` rewrites them with `patchelf` to the system loader and an `$ORIGIN`-relative `RPATH`. Before that patch `linuxdeploy` also crashed on `ldd` (exit 139).
- **AppImage and Nix glibc:** an AppImage built with a Nix-built `status-backend` may crash on systems with a different glibc (e.g., Ubuntu 26.04). The release build needs a cross-platform pipeline that avoids Nix for production binaries.
- **Sidecar overhead:** running `status-backend` as a separate process simplifies integration but requires careful lifecycle management (start, stop, and preventing zombie processes).
- **`status-go` caches:** RPC clients are cached forever; the balance cache is not invalidated. This requires a specific startup order and a local RPC forwarder (see `docs/en/networks_and_balances.md`).
- **Feature completeness:** Send/Receive/Swap/Buy are in progress; `window.ethereum` injection, Manage Tokens, and Sell are planned.

## 🚀 Current status

Stauri is in an active prototyping phase. The following key features already work:

- Dynamic launch of the `status-backend` sidecar with automatic port allocation and per-network `dataDir` isolation.
- WebSocket connection for real-time signal parsing (`node.login`, `node.stopped`, `messages.new`).
- Account creation and login.
- Messenger and wallet service initialization.
- Wallet address retrieval (`accounts_getAccounts`, filter `chat = false`).
- Balance loading with token metadata (`wallet_getTokensForActiveNetworksMode`) and grouping by network.
- Local RPC forwarder (`127.0.0.1:43057`) and user provider registration `stauri-rpc`.
- Node restart when providers change (only when `wroteProviders`).
- 5 wallet tabs (Assets / Send / Receive / Buy / Swap), token grouping, icons, cache.
- Market via CoinGecko (Rust command, 60 s cache, key from `.env`).
- Chat and contacts (list, search, send, accept requests).
- Profile (info, editing, seed phrase as placeholder).
- Settings (languages: en/ru/zh/es, themes: maroon/light/dark, font size).
- Opening dApps in isolated Tauri WebView windows.
- Dynamic network configuration via environment variables or JSON.

**Goal:** to build a fully featured, lightweight, and extensible client that uses this modular architecture to deliver all the necessary Status features.

## 🛠 Building from source

Stauri requires a prebuilt `status-backend` binary and `libsds.so` from the Status Go repository. They must be built **in the same Nix environment**.

Detailed instructions are in [BUILDING.md](./BUILDING.md). Briefly:

```bash
# 1. Build status-backend in Nix
cd ~/ETH/github.status-go
nix develop --extra-experimental-features 'nix-command flakes'
unset CGO_LDFLAGS CGO_CFLAGS
make status-backend
find /nix/store -name "libsds.so"   # take the one from -L at link time

# 2. Copy into Stauri
cp ~/ETH/github.status-go/build/bin/status-backend \
   ~/ETH/stauri/stauri-app/src-tauri/binaries/status-backend-x86_64-unknown-linux-gnu
cp /nix/store/<hash>-nim-sds-.../lib/libsds.so \
   ~/ETH/stauri/stauri-app/src-tauri/binaries/libsds.so

# 3. Run
cd ~/ETH/stauri/stauri-app
pnpm install
pnpm tauri dev

# 4. Build AppImage
./scripts/release.sh 0.2.0
