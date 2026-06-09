# ACC GeSTure Algorithm

ACCxGMAP 전시 mock-up 단계의 로봇손/지화 알고리즘 프로젝트다. 현재 구현은 두 축으로 구성된다.

1. Python 기반 skeletal camera pipeline
2. `virtual-hand-rigged-final/` 웹 기반 가상 로봇손 + 5비트 자모 인식 데모

이 README는 자모 인식 알고리즘 README와 가상 로봇손 웹앱 README의 핵심 내용을 통합한 문서다. 실행/테스트/구현 상태를 빠르게 확인하려면 이 파일을 먼저 보고, 세부 인수인계와 진행 이력은 `HANDOFF.md`를 본다. 웹앱 내부 구조의 세부 설명은 `virtual-hand-rigged-final/README.md`에도 남겨둔다.

## 현재 결론

실제/가상 카메라 화면을 MediaPipe Hands에 넣는 방식은 실험 경로로 남겨두되, 현재 발표용 주 경로는 가상 로봇손 상태를 직접 읽는 방식이다.

```txt
관객 controller slider
  -> 가상 로봇손 handState
  -> 5비트 자모 인식
  -> 자모 자동 누적
  -> 6개 자모 단위 단어 보정
  -> /display와 /recognition에 표시
```

가상 손 GLB 화면 캡처를 축소해서 손 전체가 보이게 넣어도 MediaPipe Hands는 현재 로봇손을 사람 손으로 인식하지 못했다. 대신 GLB pivot/world position에서 21개 virtual skeleton을 직접 뽑는 경로는 정상 동작한다.

## 가상 로봇손 발표 데모

위치:

```txt
virtual-hand-rigged-final/
```

실행:

```powershell
cd C:\Users\kangm\Documents\ACC-project\virtual-hand-rigged-final
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
npm install
npm run build
npm start
```

화면:

```txt
Display:     http://127.0.0.1:3001/display
Recognition: http://127.0.0.1:3001/recognition
Links:       http://127.0.0.1:3001/links
```

발표 때는 `/display`와 `/recognition` 두 창을 띄운다.

5비트 규칙:

```txt
손가락 순서: 엄지 -> 검지 -> 중지 -> 약지 -> 소지
0~49        접힘 = 0
50~100      펴짐 = 1
0~30        ㄱ부터 ㅢ까지 31개 자모
31          모든 손가락 펴짐/rest, 자모 미입력
```

자모 mapping:

```txt
0  ㄱ   1  ㄴ   2  ㄷ   3  ㄹ   4  ㅁ   5  ㅂ   6  ㅅ   7  ㅇ
8  ㅈ   9  ㅊ   10 ㅋ   11 ㅌ   12 ㅍ   13 ㅎ
14 ㅏ   15 ㅑ   16 ㅓ   17 ㅕ   18 ㅗ   19 ㅛ   20 ㅜ   21 ㅠ
22 ㅡ   23 ㅣ   24 ㅐ   25 ㅒ   26 ㅔ   27 ㅖ   28 ㅚ   29 ㅟ   30 ㅢ
```

Synthetic training sample:

```txt
31 labels x 24 samples = 744 samples
open sample range:   80~100
closed sample range: 0~20
classification threshold: 50
```

자동 입력:

```txt
추정 자모가 바뀌면 buffer에 자동 추가
같은 자모가 연속으로 들어오면 중복 추가하지 않음
buffer가 6개가 되면 Hangul compose + local vocabulary correction
최종 단어는 /display의 AUTO WORD 카드에 표시
```

검증된 예:

```txt
입력: ㄱㅏㅇㅅㅏㄴ
compose: 강산
correctedWord: 강산
중복 테스트: ㄱ, ㄱ, ㄴ -> buffer ㄱㄴ
```

자세한 웹 구조와 Blender pivot 정보는 `virtual-hand-rigged-final/README.md`를 본다.

## Python Pipeline

Python 쪽은 기존 카메라/skeleton 실험과 virtual skeleton 확인용으로 유지한다.

설치:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
```

Python version:

```txt
Python 3.10, 3.11, or 3.12
mediapipe==0.10.14
```

주요 명령:

```powershell
acc-gesture check --no-camera
acc-gesture check --camera 0 --save-frame data/check_frame.jpg
acc-gesture preview --camera 0
acc-gesture capture --label ㄱ --camera 0 --samples 20 --output data/reference_samples.jsonl
acc-gesture recognize --camera 0 --references data/reference_samples.jsonl
acc-gesture compose --camera 0 --references data/reference_samples.jsonl --output data/compose_session.jsonl
acc-gesture screen-check --image data\virtual_hand_open_zoomout.png --save-overlay data\virtual_hand_open_zoomout_overlay.png
acc-gesture virtual-check --url http://127.0.0.1:3001/virtual-skeleton --no-recognizer
acc-gesture virtual-capture --label test_open --url http://127.0.0.1:3001/virtual-skeleton --samples 5 --output data\virtual_reference_samples_test.jsonl
```

Python pipeline 상태:

```txt
MediaPipe camera skeleton extraction: 구현됨
Skeleton normalization: 구현됨
Reference sample capture/nearest recognizer: 구현됨
Manual jamo compose + Ollama correction: 구현됨
Virtual screen capture MediaPipe check: 구현됨, 현재 no hand detected
Virtual skeleton fetch/capture/check: 구현됨
```

## 파일 구조

```txt
src/gesture_pipeline/
  skeleton.py          MediaPipe 21 landmark extractor
  virtual_skeleton.py  /virtual-skeleton API fetch/capture/check
  screen_check.py      captured screen image MediaPipe 검사
  recognizer.py        nearest-reference recognizer
  hangul.py            jamo compose
  llm.py               Ollama word correction
  cli.py               acc-gesture command entrypoint

virtual-hand-rigged-final/
  server/binaryJamo.ts 5비트 자모 mapping/sample/correction
  server/index.ts      Express + Socket.IO API
  client/src/pages/    display, recognition, links, controller
  client/src/components/VirtualHand.tsx
  public/models/robot_hand_rig.glb
```

## 검증 명령

```powershell
.\.venv\Scripts\python.exe -m compileall src

cd virtual-hand-rigged-final
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
npx tsc -p tsconfig.server.json --noEmit
npm run build
```

서버 실행 후 API smoke test:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health'
Invoke-RestMethod -Uri 'http://127.0.0.1:3001/training-samples'
Invoke-RestMethod -Uri 'http://127.0.0.1:3001/recognition-state'
```

## Coordination

- 작업 시작 전 가능하면 `git pull --rebase origin main`.
- Windows에서 `git`이 PATH에 없으면 `C:\Program Files\Git\cmd\git.exe`를 사용.
- 변경 후에는 Python compile, TypeScript check, Vite build를 최소 검증으로 실행.
- 가상 손 폴더의 `node_modules/`, `dist/`, `*.log`는 커밋하지 않는다.
- `public/models/robot_hand_rig.glb`는 약 68MB이므로 GitHub push가 부담되면 Git LFS 전환을 검토한다.

## 다음 작업

1. 발표 문맥에 맞춰 local correction vocabulary를 확장한다.
2. 여러 관객이 동시에 움직일 때 transient bit가 너무 많이 들어오면 300~500ms smoothing을 추가한다.
3. 필요하면 31개 자모 mapping 순서를 실제 발표 시나리오에 맞게 재배열한다.
4. virtual skeleton confidence를 5비트 인식 UI에 더 적극적으로 반영한다.
