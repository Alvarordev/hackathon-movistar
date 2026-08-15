#!/usr/bin/env bash
# Ejercita el copiloto y muestra el diálogo legible: qué tools llamó y qué dijo.
# Uso: ./scripts/probar_copiloto.sh CLI000013 "¿Qué le ofrezco y por qué?"
set -uo pipefail

BASE="${BASE:-http://localhost:3000/api}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENTE="${1:?falta cliente_id}"
PREGUNTA="${2:?falta la pregunta}"

printf '\n\033[1m▸ %s\033[0m  (cliente %s)\n' "$PREGUNTA" "$CLIENTE"

python3 -c "
import json, sys
print(json.dumps({'cliente_id': sys.argv[1],
                  'messages': [{'role': 'user', 'content': sys.argv[2]}]}))
" "$CLIENTE" "$PREGUNTA" \
  | curl -sN -X POST "$BASE/copiloto/chat" \
         -H 'Content-Type: application/json' -d @- --max-time 120 \
  | python3 "$AQUI/_render_sse.py"
