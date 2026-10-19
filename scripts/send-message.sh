#!/usr/bin/env bash
set -euo pipefail

# Использование:
# ./scripts/send-message.sh <PORT> "Текст сообщения"
#
# Пример:
# ./scripts/send-message.sh 37285 "Hello from script!"

if [ $# -ne 2 ]; then
    echo "Usage: $0 <PORT> \"Message text\""
    exit 1
fi

PORT="$1"
TEXT="$2"

# Получаем публичный ключ
PUBKEY=$(curl -s -X POST "http://127.0.0.1:${PORT}/statusgo/CallRPC" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"settings_getSettings","params":[]}' \
  | grep -o '"public-key":"[^"]*"' | cut -d'"' -f4)

if [ -z "$PUBKEY" ]; then
    echo "Error: Could not retrieve public key. Is the backend running and logged in?"
    exit 1
fi

echo "Using public key: $PUBKEY"
echo "Sending message: \"$TEXT\""

# Создаем чат (если ещё не создан — ошибка игнорируется)
curl -s -X POST "http://127.0.0.1:${PORT}/statusgo/CallRPC" \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 1,
    \"method\": \"wakuext_createOneToOneChat\",
    \"params\": [{\"id\": \"$PUBKEY\"}]
  }" > /dev/null

# Отправляем сообщение
RESPONSE=$(curl -s -X POST "http://127.0.0.1:${PORT}/statusgo/CallRPC" \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 1,
    \"method\": \"wakuext_sendChatMessage\",
    \"params\": [{
      \"chatId\": \"$PUBKEY\",
      \"text\": \"$TEXT\",
      \"contentType\": 1
    }]
  }")

echo "Response: $RESPONSE"
