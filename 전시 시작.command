#!/bin/zsh
# Finder 실행에서도 Homebrew 도구를 찾는다. 앱·모델은 Mac mini에서만 실행.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "${0:A:h}/jeju-exhibition" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js가 없습니다. HANDOFF의 최초 준비를 먼저 진행하세요.'
elif [[ ! -f node_modules/socket.io-client/package.json ]]; then
  print '의존성 설치가 필요합니다. jeju-exhibition 폴더에서 npm ci를 실행하세요.'
elif [[ ! -f .env ]]; then
  print '최초 설정이 필요합니다. jeju-exhibition 폴더에서 npm run setup을 실행하세요.'
else
  node scripts/exhibition-start.mjs
fi
print '\n종료되었습니다. 이 창을 닫아도 됩니다.'
read '?Enter를 누르면 창을 마칩니다. '
