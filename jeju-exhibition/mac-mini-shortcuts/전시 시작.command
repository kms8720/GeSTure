#!/bin/bash
set -euo pipefail
repo="$(dirname -- "${BASH_SOURCE[0]}")/GeSTure"
runtime="$HOME/.local/share/gesture-runtime"
export PATH="$runtime/node/bin:$runtime/ollama:$runtime/bin:$PATH"
cd -- "$repo/jeju-exhibition"

case "${1:-}" in
  ''|--exhibition)
    if [ "${1:-}" = '--exhibition' ]; then
      if [ "$#" -ne 2 ] || [[ ! "$2" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$ ]]; then
        printf '전시 ID는 영문·숫자·하이픈·밑줄로 입력하세요. 예: jeju-open-senses\n' >&2
        exit 2
      fi
      export WORD_CLOUD_FILE="$PWD/data/exhibitions/$2/word-cloud.json"
    fi
    printf '인터넷 전시 운영 모드 · 고정 QR 입구를 사용합니다.\n'
    exec ../'전시 시작.command'
    ;;
  --login)
    exec gh auth login --hostname github.com --web
    ;;
  --lan)
    other_port=3003
    export CONNECTION_MODE=lan
    printf '같은 네트워크에서 참여하는 LAN 운영 모드\n'
    ;;
  --check)
    other_port=3002
    export PORT=3003
    export CONNECTION_MODE=lan
    export PUBLIC_ORIGIN=''
    export WORD_CLOUD_FILE="$PWD/data/rehearsal/word-cloud.json"
    printf '전시 점검 모드 (3003) · 점검 기록을 사용합니다.\n'
    ;;
  --key)
    key="$(node --input-type=module -e '
      import { readFileSync } from "node:fs";
      import { parseEnv } from "node:util";
      const key = parseEnv(readFileSync(".env", "utf8")).OPERATOR_TOKEN?.trim();
      if (!key) { console.error(".env에 운영자 키가 없습니다."); process.exit(1); }
      process.stdout.write(key);
    ')"
    printf '%s' "$key" | /usr/bin/pbcopy
    printf '운영자 키를 복사했습니다. 운영 모니터의 운영자 키 칸에 붙여넣으세요.\n'
    exit
    ;;
  *)
    printf '사용법: %s [--login | --lan | --check | --key | --exhibition ID]\n' "$0" >&2
    exit 2
    ;;
esac

if /usr/sbin/lsof -nP -iTCP:"$other_port" -sTCP:LISTEN >/dev/null 2>&1; then
  printf '포트 %s 사용 중입니다. 기존 전시 또는 점검 창에서 Control+C를 누르고 다시 시작하세요.\n' "$other_port" >&2
  exit 1
fi

exec ./scripts/start-mac.command
