# Building Stauri

This guide covers how to build `status-backend` in a Nix environment and prepare it as a sidecar for the Tauri application.

## Prerequisites

- [Nix](https://nixos.org/download.html) (with flakes enabled)
- Rust & Cargo (usually managed by `rustup` or your OS package manager)
- Node.js (v24+) & pnpm
- `patchelf` (for Linux binary patching)

## Step 1: Build `status-backend` in Nix

Clone the `status-go` repository and build the backend inside the Nix development shell:

```bash
git clone https://github.com/status-im/status-go.git
cd status-go
nix develop --extra-experimental-features 'nix-command flakes'

# Inside the Nix shell:
make statusgo

After the build completes, you will find status-backend in status-go/build/bin/. You will also need libsds.so, which is located in the Nix store (usually under .../nim-sds-.../lib/libsds.so).
Step 2: Prepare Binaries for Tauri

Copy the binaries into tauri-app/src-tauri/binaries/ and rename status-backend with the appropriate target-triple suffix.
bash

# Example for Linux x86_64
cd tauri-app/src-tauri/binaries/

cp ../../../status-go/build/bin/status-backend ./status-backend-x86_64-unknown-linux-gnu
cp /nix/store/.../lib/libsds.so ./

# Give execution permissions
chmod 755 status-backend-x86_64-unknown-linux-gnu libsds.so

Important: The binaries built in Nix are hard-linked to /nix/store. You must patch them to run outside the Nix environment:
bash

patchelf --set-interpreter /lib64/ld-linux-x86-64.so.2 status-backend-x86_64-unknown-linux-gnu
patchelf --set-rpath '$ORIGIN' status-backend-x86_64-unknown-linux-gnu
patchelf --set-rpath '$ORIGIN' libsds.so

Step 3: Configure Tauri

Ensure the following files are configured correctly:

    tauri.conf.json: Add the sidecar to bundle:
    json

    "bundle": {
      "externalBin": ["binaries/status-backend"],
      "resources": ["binaries/libsds.so"],
      ...
    }

    src-tauri/capabilities/default.json: Ensure you have the required permissions:
    json

    "permissions": [
      "core:default",
      "core:window:allow-close",
      "core:webview:allow-create-webview-window",
      "shell:allow-spawn",
      "shell:allow-kill",
      "websocket:default",
      "global-shortcut:allow-register",
      "global-shortcut:allow-unregister",
      {
        "identifier": "http:default",
        "allow": [{ "url": "http://127.0.0.1:*" }]
      }
    ]

Step 4: Run Stauri

Navigate to the tauri-app directory and start the development server:
bash

pnpm install
pnpm tauri dev

The application will launch, start the sidecar backend automatically, and you can log in with your test account.
