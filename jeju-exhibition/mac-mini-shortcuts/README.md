# Mac mini 실행 파일과 화면 바로가기

이 폴더는 전시용 Mac mini에서 사용 중인 바로가기의 배포 원본이다. 이 폴더의 `.command` 파일·`전시 운영 안내.txt`·`전시 화면 바로가기` 폴더를 **GeSTure 저장소의 부모 폴더**에 복사해 사용한다. 실행 파일은 같은 폴더의 `GeSTure/`를 찾으므로 이 원본 폴더 안에서 직접 실행하지 않는다. 이미 설치한 파일은 변경 내용을 비교한 뒤 갱신한다.

- `전시 시작.command`: 기본은 인터넷 전시. `--lan`은 같은 네트워크 운영, `--exhibition ID`는 전시별 기록, `--login`은 GitHub 로그인이다.
- `전시 점검.command`: 3003 포트와 별도 점검 기록을 쓴다. 인터넷 전시 게이트웨이와 포트가 겹치므로 동시에 실행하지 않는다.
- `전시 운영자 키.command`: 로컬 `.env`의 운영자 키를 클립보드에 복사한다. 키 자체는 이 폴더나 GitHub에 포함되지 않는다.
- `전시 화면 바로가기`: 3002 운영·3003 점검 화면의 localhost 링크다. 휴대폰·iPad용 주소가 아니다.

Mac mini의 `~/.local/share/gesture-runtime/`에 준비한 Node·Ollama·gh·cloudflared 또는 PATH의 도구를 사용한다. 공통 준비와 iPad LAN 실행은 [실행 안내](../docs/mac-mini-handoff.md), 실제 변경·검수 기록은 루트 [HANDOFF](../../HANDOFF.md)를 따른다. `.env`와 전시 JSON/TXT, 모델 가중치는 별도 로컬 자료다.
