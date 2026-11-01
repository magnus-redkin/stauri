# Stauri Architecture

This document describes how Stauri is structured as a whole: what layers it
consists of, how they communicate, and why the boundaries are drawn the way
they are. It complements `networks_and_balances.md` (the concrete path from a
balance to the screen), `status_outdated_architecture.md` (why `status-go` is
complex) and `BUILDING.md` (building `status-backend` in Nix).

## 1. The main decision: a sidecar, not a library

Stauri does not link `status-go` as a library. It runs `status-backend` as a
**separate process** (sidecar) and talks to it over two channels:

- **HTTP** (`http://127.0.0.1:<port>/statusgo/CallRPC`) — requests;
- **WebSocket** (`ws://127.0.0.1:<port>/signals`) — asynchronous signals.

There are exactly two reasons:

1. **Lifecycle.** A crash or restart of `status-go` must not take the UI down.
   The process can be killed and restarted without touching the app window.
2. **Versioning.** The `status-go` binary is built separately (Nix/Go), while
   the frontend is built with Svelte. They can be updated independently as long
   as the JSON-RPC contract does not change.

The price is process management: `start_backend` / `stop_backend`, a PID file,
killing "zombies" at startup. All of this lives in `src-tauri/src/lib.rs`.
Additionally: `status-backend` and `libsds.so` must be built in the **same Nix
environment** (same glibc, same ABI), otherwise `status-backend` crashes with
`SIGSEGV` while loading `libsds.so` (see `BUILDING.md`).

## 2. Layers
