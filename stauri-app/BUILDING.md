# Building Stauri

This guide covers how to build `status-backend` in a Nix environment and prepare it as a sidecar for the Tauri application.

## Prerequisites

- **Nix** (with flakes enabled)
- **Rust** >= 1.85 (needed for `edition = "2024"`)
- **Node.js** (v20+) & **pnpm**
- **patchelf** (for Linux binary patching)
- **System packages for Tauri on Linux**: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`.
- **glibc >= 2.38** on the target machine (due to Nix build requirements).

## Step 1: Build `status-backend` in Nix

Clone the `status-go` repository and checkout the tested version:

```bash
git clone https://github.com/status-im/status-go.git
cd status-go
# IMPORTANT: Checkout the tested commit/tag for Stauri
git checkout 766535cf3 # Replace with actual commit if needed
nix develop --extra-experimental-features 'nix-command flakes'

# Inside the Nix shell:
make statusgo

After the build completes, you will find status-backend in status-go/build/bin/. You will also need libsds.so, which is located in the Nix store (usually under .../nim-sds-.../lib/libsds.so).
Step 2: Prepare Binaries for Tauri

Use the provided script to copy and patch the binaries:
bash

# From the repository root (staturi/)
chmod +x scripts/prepare-sidecar.sh
./scripts/prepare-sidecar.sh status-go/build/bin/status-backend /nix/store/.../lib/libsds.so

This script will:

    Detect your target triple.

    Copy binaries to tauri-app/src-tauri/binaries/.

    Apply patchelf (on Linux) to replace the interpreter and RPATH with $ORIGIN.

    Check for unresolved or Nix dependencies.

Step 3: Configure Tauri

Ensure tauri-app/src-tauri/tauri.conf.json and tauri-app/src-tauri/capabilities/default.json are configured (see the files in the repository).
Step 4: Run Stauri
bash

cd tauri-app
pnpm install
pnpm tauri dev

Note: The release build (pnpm tauri build) has not been fully tested yet. Bundling libsds.so into the final package requires further investigation.
text


### 🧹 Шаг 3: Переименовываем шаблонные поля

**В `tauri-app/src-tauri/Cargo.toml`**:
```toml
[package]
name = "stauri"
version = "0.1.0"
description = "A lightweight desktop client for the Status ecosystem"
authors = ["Your Name"]
edition = "2024"
license = "MIT" # или Apache-2.0

[lib]
name = "stauri_lib" # <-- Важно: это имя используется в main.rs
# ...

Не забудьте обновить src-tauri/src/main.rs: там строка tauri_app_lib::run() должна стать stauri_lib::run().

В tauri-app/src-tauri/tauri.conf.json:
json

{
  "productName": "Stauri",
  "identifier": "com.magnus.stauri",
  // ...
}
