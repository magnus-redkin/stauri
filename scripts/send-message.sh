#!/usr/bin/env bash
set -euo pipefail

MESSAGE="${1:-Hello}"
TO_PUBKEY="${2:-}"

PORT=$(ss -tlnp 2>/dev/null | grep status-backend | grep -oE '127\.0\.0\.1:[0-9]+' | head -1 | cut -d':' -f2)
if [ -z "$PORT" ]; then echo "Error: no status-backend found"; exit 1; fi

MY_PUBKEY=$(curl -s -X POST "http://127.0.0.1:${PORT}/statusgo/CallRPC" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"settings_getSettings","params":[]}' \
  | grep -o '"public-key":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TO_PUBKEY" ]; then TO_PUBKEY="$MY_PUBKEY"; fi

curl -s -X POST "http://127.0.0.1:${PORT}/statusgo/CallRPC" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"wakuext_createOneToOneChat\",\"params\":[{\"id\":\"$TO_PUBKEY\"}]}" > /dev/null

RESPONSE=$(curl -s -X POST "http://127.0.0.1:${PORT}/statusgo/CallRPC" \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"wakuext_sendChatMessage\",\"params\":[{\"chatId\":\"$TO_PUBKEY\",\"text\":\"$MESSAGE\",\"contentType\":1}]}")

echo "Response: $RESPONSE"
