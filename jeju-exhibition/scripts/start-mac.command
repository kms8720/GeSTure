#!/bin/bash
# Finder에서 더블 클릭하거나 터미널에서 실행하는 전시용 실행기.
set -euo pipefail
# 각 백그라운드 작업을 별도 그룹에 두어 Ollama의 모델 프로세스도 함께 정리한다.
set -m

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

fail() { printf '\n실행 중단: %s\n' "$*" >&2; exit 1; }
supported_node() {
  [ -x "$1" ] && "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22 || (a===22 && b>=18) ? 0 : 1)' 2>/dev/null
}

NODE="${GESTURE_NODE:-$(command -v node || true)}"
if ! supported_node "$NODE"; then
  NODE="$HOME/.local/share/gesture-runtime/node/bin/node"
fi
supported_node "$NODE" || fail 'Node.js 22.18 이상이 필요합니다. 설치 후 GESTURE_NODE에 node 실행 파일 경로를 지정하세요.'
export PATH="$(dirname "$NODE"):$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
[ -f .env ] || fail '.env가 없습니다. 먼저 npm run setup으로 전시 설정을 준비하세요.'
[ -f dist/index.html ] || fail '빌드가 없습니다. 먼저 npm run build를 실행하세요.'
[ -f node_modules/tsx/package.json ] || fail '의존성이 없습니다. 먼저 npm ci를 실행하세요.'

# .env는 셸 코드로 실행하지 않는다. 외부 환경변수는 .env보다 우선한다.
CONFIG="$("$NODE" --env-file=.env --input-type=module - <<'JS'
const port = Number(process.env.PORT ?? 3002);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT는 1~65535 정수여야 합니다.');
const url = new URL(process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434');
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
  throw new Error('OLLAMA_URL에는 http(s) 서버 주소만 지정하세요.');
const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
console.log([port, url.origin, local ? 'yes' : 'no', url.port || (url.protocol === 'https:' ? 443 : 80)].join('\t'));
JS
)" || fail '.env의 PORT / OLLAMA_URL을 확인하세요.'
IFS=$'\t' read -r APP_PORT OLLAMA_URL LOCAL_OLLAMA OLLAMA_PORT <<< "$CONFIG"
export OLLAMA_URL

port_busy() { /usr/sbin/lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
port_busy "$APP_PORT" && fail "포트 $APP_PORT 사용 중입니다. 기존 전시 실행 창을 확인하세요."

APP_PID=''
OLLAMA_PID=''
CAFFEINATE_PID=''
cleanup() {
  trap - EXIT INT TERM HUP
  # 아래 그룹은 이 실행기가 시작한 작업과 그 자식 프로세스만 포함한다.
  for pid in "$APP_PID" "$CAFFEINATE_PID" "$OLLAMA_PID"; do
    [ -z "$pid" ] || kill -TERM -- "-$pid" 2>/dev/null || true
  done
  local deadline=$((SECONDS + 3))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local running=no
    for pid in "$APP_PID" "$CAFFEINATE_PID" "$OLLAMA_PID"; do
      if [ -n "$pid" ] && kill -0 -- "-$pid" 2>/dev/null; then running=yes; fi
    done
    [ "$running" = yes ] || break
    sleep 0.1
  done
  for pid in "$APP_PID" "$CAFFEINATE_PID" "$OLLAMA_PID"; do
    [ -z "$pid" ] || kill -KILL -- "-$pid" 2>/dev/null || true
    [ -z "$pid" ] || wait "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

ollama_ready() { /usr/bin/curl --silent --fail --max-time 1 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; }
if ollama_ready; then
  printf '실행 중인 Ollama를 사용합니다: %s\n' "$OLLAMA_URL"
else
  [ "$LOCAL_OLLAMA" = yes ] || fail "Ollama에 연결할 수 없습니다: $OLLAMA_URL"
  port_busy "$OLLAMA_PORT" && fail "Ollama 포트 $OLLAMA_PORT 사용 중이지만 API가 응답하지 않습니다. 기존 실행을 확인하세요."
  OLLAMA="${GESTURE_OLLAMA:-$HOME/.local/share/gesture-runtime/ollama/ollama}"
  [ -x "$OLLAMA" ] || fail "Ollama 실행 파일이 없습니다: $OLLAMA (GESTURE_OLLAMA로 지정 가능)"
  # 서버용 .env 전체를 Ollama에 전달하지 않는다. 메모리/로컬 실행 설정만 허용한다.
  OLLAMA_SETTINGS="$("$NODE" --env-file=.env --input-type=module - <<'JS'
for (const key of ['OLLAMA_CONTEXT_LENGTH', 'OLLAMA_FLASH_ATTENTION', 'OLLAMA_KV_CACHE_TYPE',
  'OLLAMA_NUM_PARALLEL', 'OLLAMA_MAX_LOADED_MODELS', 'OLLAMA_NO_CLOUD']) {
  const value = process.env[key];
  if (value === undefined) continue;
  if (/[\r\n\0]/.test(value)) throw new Error(`${key}에는 한 줄 값만 지정하세요.`);
  console.log(`${key}=${value}`);
}
JS
  )" || fail 'Ollama 실행 설정을 확인하세요.'
  OLLAMA_ENV=("OLLAMA_HOST=${OLLAMA_URL#http://}")
  while IFS= read -r setting; do
    [ -z "$setting" ] || OLLAMA_ENV+=("$setting")
  done <<< "$OLLAMA_SETTINGS"
  printf 'Ollama 시작: %s\n' "$OLLAMA_URL"
  /usr/bin/env -u OPERATOR_TOKEN "${OLLAMA_ENV[@]}" "$OLLAMA" serve &
  OLLAMA_PID=$!
  deadline=$((SECONDS + 20))
  until ollama_ready; do
    kill -0 "$OLLAMA_PID" 2>/dev/null || fail 'Ollama가 종료되었습니다. 위 오류를 확인하세요.'
    [ "$SECONDS" -lt "$deadline" ] || fail 'Ollama가 20초 안에 준비되지 않았습니다.'
    sleep 0.2
  done
fi

# 모델 다운로드는 운영자가 별도로 수행한다. 없는 모델로 전시를 시작하지 않는다.
"$NODE" --env-file=.env --input-type=module - <<'JS'
const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
const canonical = (name) => name.includes(':') ? name : `${name}:latest`;
try {
  const response = await fetch(`${process.env.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.models) || !data.models.some((entry) => canonical(entry.name ?? '') === canonical(model)))
    throw new Error(`모델 ${model}이 없습니다. 해당 Ollama 서버에 모델을 먼저 준비하세요.`);
  console.log(`모델 확인: ${model}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
JS

port_busy "$APP_PORT" && fail "포트 $APP_PORT 사용 중입니다. 기존 전시 실행 창을 확인하세요."
printf '\n전시 시작: http://localhost:%s/monitor\n종료: 이 터미널에서 Control+C\n\n' "$APP_PORT"
"$NODE" --import tsx server/index.ts &
APP_PID=$!
/usr/bin/caffeinate -di -w "$APP_PID" &
CAFFEINATE_PID=$!
wait "$APP_PID"
