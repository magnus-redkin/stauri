# Stauri (Status Tauri Client)

**Stauri** is a lightweight desktop client for the Status ecosystem, built as an actively developing alternative to the official `status-desktop`.

Powered by **Tauri (Rust)** and **Svelte 5**, Stauri uses a sidecar architecture to interact with the Status backend (`status-backend`) via local WebSocket and HTTP. This approach preserves the full power of `status-go` while providing a modern, fast, and highly flexible user interface.

## ✨ Expected Advantages over `status-desktop`

- **Modern Stack (Svelte 5 + Tailwind CSS):** Delivers a faster, more responsive UI compared to the Nim/QML stack, significantly improving development speed and user experience.
- **Modular Architecture:** Clear separation of concerns (Chat, Wallet, dApps Browser). This makes the codebase easier to maintain, extend, and adapt for future features.
- **Security through Isolation:** dApps are opened in isolated Tauri WebView windows, reducing the attack surface compared to a monolithic QML application. Future updates will introduce a secure `window.ethereum` injection with granular permissions.
- **Native Cross-Platform:** Tauri provides native support for Windows, macOS, and Linux out of the box with minimal bundle sizes.
- **Extensible by Design:** The decoupled UI and Rust backend allow for easy implementation of custom plugins and features without touching the core Status protocol.

## ⚙️ Network Configuration

By default, Stauri connects to **Ethereum Mainnet** and the **Waku Production Fleet**. However, you can easily switch to test networks or use custom RPCs for development.

### 1. Quick Switch (Shorthand)
Use the provided `pnpm` scripts, which utilize the `STAURI_NETWORK` environment variable:

```bash
Run on Mainnet (Default)
pnpm dev
Run on Sepolia Testnet
pnpm dev:sepolia
Run on Holesky Testnet
pnpm dev:holesky
```

### 2. Advanced Configuration (Custom JSON)
For custom RPCs, specific Chain IDs, or advanced Waku settings, create a `config.json` file:

```json
{
  "ethereum": {
    "preset": "sepolia",
    "chain_id": 11155111,
    "rpc_url": "https://rpc.sepolia.org"
  },
  "waku": {
    "fleet": "status.test"
  }
}
```

Then, run the application pointing to this file:

```bash
STAURI_CONFIG_PATH=./config.json pnpm dev
```

(Alternatively, place this file at ~/.config/stauri/config.json and it will be loaded automatically).

🛡️ Data Isolation
To prevent data corruption, Stauri isolates network data. Mainnet uses the root application data directory, while testnets create isolated subdirectories (e.g., .../stauri/sepolia/). Your Mainnet profiles and keys remain completely safe when testing on Sepolia.
🖥️ UI Indicators
When connected to a testnet, Stauri provides clear visual cues:

    An orange warning banner at the top of the application.
    Detailed network information (Network Name, Chain ID, RPC URL, Waku Fleet) displayed in the left sidebar under the Profile section.

⚠️ Known Limitations & Challenges

    Nix Binary Portability: The status-backend binary compiled in Nix is hard-linked to the Nix glibc (via /nix/store). For the current prototype, we use patchelf to replace the interpreter and RPATH, and bundle libsds.so manually. A proper cross-platform build pipeline (avoiding Nix for production binaries) is required for release.
    Sidecar Overhead: Running status-backend as a separate process simplifies integration but requires careful lifecycle management (starting, stopping, and preventing zombie processes).
    Feature Completeness: Currently, only foundational features are implemented (login, messenger startup, wallet address retrieval, and dApp window opening). Full messaging, contact management, and window.ethereum injection are actively in development.

🚀 Current Status
Stauri is in an active prototyping phase. The following core features are working:

    Dynamic sidecar launch of status-backend with automatic port allocation and network-aware dataDir isolation.
    WebSocket connection for real-time signals parsing.
    Account creation and login flow.
    Messenger and Wallet service initialization.
    dApps opened in isolated Tauri windows (WebView).
    Dynamic network configuration via environment variables or JSON.

Goal: Build a fully featured, lightweight, and extensible client that leverages this modular architecture to provide all essential Status features.

🛠 Building from Source
Stauri requires a pre-built status-backend binary from the Status Go repository, which must be patched for your target system.
For detailed instructions on how to prepare the Nix binaries and compile the project, please refer to BUILDING.md
.
📦 Tech Stack

    Frontend: Svelte 5, SvelteKit, Tailwind CSS, shadcn-svelte
    Backend: Rust, Tauri 2
    Status Integration: status-backend (sidecar), WebSocket (signals), HTTP (RPC)
