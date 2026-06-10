# ACC GeSTure

ACCxGMAP 전시 mock-up 단계의 로봇손/지화 알고리즘 프로젝트다. 이 저장소는 카메라 기반 자모 인식 실험, 발표용 가상 로봇손 웹앱, 그리고 앞으로 추가될 실제 전시용 모터 제어 코드를 한 프로젝트 안에서 관리한다.

## 전체 맥락

초기 방향은 카메라가 로봇손을 촬영하고 MediaPipe Hands가 21개 skeletal landmark를 추출해 지화 자모를 인식하는 방식이었다. 현재 발표용 주 경로는 웹앱의 가상 로봇손 상태를 직접 읽는 방식으로 바뀌었다.

```txt
관객 controller slider
  -> 가상 로봇손 handState
  -> 5비트 자모 인식
  -> 자모 자동 누적
  -> 6개 자모 단위 Ollama LLM 단어 보정
  -> /display와 /recognition에 표시
```

카메라/MediaPipe 경로는 연구와 비교 검증용으로 유지한다. 가상 로봇손 렌더 화면을 캡처해서 MediaPipe에 넣는 실험은 현재 `no hand detected`로 실패했으므로, 발표용 입력은 화면 캡처가 아니라 `handState`와 GLB pivot 기반 virtual skeleton을 우선 사용한다.

## 프로젝트 폴더 구조

```txt
GeSTure/
├── README.md
│   └── 프로젝트 전체 지도, 폴더 역할, 구현/미구현 상태
├── HANDOFF.md
│   └── 최신 진행상황, 검증 결과, 다음 작업 인수인계
├── jamo-recognition/
│   ├── README.md
│   ├── pyproject.toml
│   ├── src/
│   │   └── gesture_pipeline/
│   │       ├── cli.py
│   │       ├── skeleton.py
│   │       ├── recognizer.py
│   │       ├── hangul.py
│   │       ├── llm.py
│   │       ├── screen_check.py
│   │       └── virtual_skeleton.py
│   ├── data/
│   │   └── reference_samples.jsonl
│   └── docs/
│       └── algorithm_plan.md
├── virtual-hand-rigged-final/
│   ├── README.md
│   ├── server/
│   │   ├── index.ts
│   │   └── binaryJamo.ts
│   ├── client/src/
│   │   ├── pages/
│   │   ├── components/
│   │   └── socket/
│   ├── public/models/
│   │   └── robot_hand_rig.glb
│   └── scripts/
├── motor-control/
│   └── README.md
└── data/
    └── local-only captures, JSONL logs, test outputs
```

### 영역별 역할

| 영역 | 현재 폴더 | 역할 |
| --- | --- | --- |
| 자모음 알고리즘 | `jamo-recognition/` | Python 기반 카메라/MediaPipe/skeleton 추출, reference sample, 자모 인식, 한글 compose, Python Ollama 보정 실험 |
| 발표용 웹앱 | `virtual-hand-rigged-final/` | 가상 로봇손, 관객 controller, 5비트 자모 인식, 자동 자모 누적, Ollama 단어 보정, display/recognition 화면 |
| 실제 모터 제어 | `motor-control/` | 실제 전시용 로봇손 모터/servo/actuator 제어 코드가 들어갈 예정 영역 |
| 문서/인수인계 | `README.md`, `HANDOFF.md`, 각 영역별 `README.md` | 전체 맥락, 진행 기록, 영역별 세부 운영법 |
| 로컬 데이터 | `data/` | frame capture, JSONL session log 등 로컬 산출물 |

## 구현된 부분

### 1. Python 자모음 알고리즘

- OpenCV camera open/check/preview
- MediaPipe Hands 기반 21개 landmark 추출
- wrist-origin, palm-scale, palm-rotation 기반 skeleton normalization
- labeled reference skeleton capture
- reference sample 기반 nearest recognizer
- live recognition overlay
- live compose mode
- Python Ollama word correction 실험
- virtual screen capture MediaPipe check
- 웹앱 `/virtual-skeleton` fetch/check/capture

설치:

```sh
.venv/bin/pip install -e jamo-recognition
```

주요 명령:

```sh
.venv/bin/acc-gesture check --no-camera
.venv/bin/acc-gesture preview --camera 0
.venv/bin/acc-gesture recognize --camera 0 --references jamo-recognition/data/reference_samples.jsonl
.venv/bin/acc-gesture compose --camera 0 --references jamo-recognition/data/reference_samples.jsonl --output data/compose_session.jsonl
.venv/bin/acc-gesture screen-check --image data/virtual_hand_open_zoomout.png --save-overlay data/virtual_hand_open_zoomout_overlay.png
.venv/bin/acc-gesture virtual-check --url http://127.0.0.1:3001/virtual-skeleton --no-recognizer
```

자모음 알고리즘 세부 내용은 `jamo-recognition/README.md`를 본다.

### 2. 발표용 웹앱

- `/display`: 로봇손 전시 화면, 최종 단어 표시
- `/recognition`: 현재 bit, 자모, buffer, 보정 단어 모니터
- `/links`: 손가락별 controller QR/link
- `/control/:finger`: 관객용 손가락 하나 조종 화면
- 5개 손가락 상태를 5비트로 변환
- 0~30은 `ㄱ`부터 `ㅢ`까지 31개 자모
- 31, 즉 `11111`은 rest pose로 두고 자모 입력하지 않음
- 자모가 바뀌면 자동 buffer 추가
- 현재 6개 buffer 안에 이미 들어간 자모는 다시 입력하지 않음
- buffer 6개가 모이면 Ollama LLM으로 1~4글자 한국어 단어 보정
- LLM은 자모 순서 변경, 일부 삭제, 빠진 자모 보완을 허용

대표 검증:

```txt
ㄱㅏㅇㅅㅏㄴ -> 강산
ㅂㅕㅇㅊㅓㄴ -> 친구
ㅂ, rest, ㅂ -> buffer ㅂ
```

실행:

```sh
cd virtual-hand-rigged-final
npm install
npm run build
npm start
```

접속:

```txt
Display:     http://DEVICE_IP:3001/display
Recognition: http://DEVICE_IP:3001/recognition
Links:       http://DEVICE_IP:3001/links
```

휴대폰 QR을 쓰려면 `127.0.0.1`이나 `localhost`가 아니라, 테스트창을 실행하는 노트북/디바이스의 같은 Wi-Fi IP를 항상 사용한다. 예를 들어 Mac에서는 다음으로 IP를 확인한다.

```sh
ipconfig getifaddr en0
```

예:

```txt
http://192.168.0.129:3001/links
```

웹앱 세부 구조와 운영법은 `virtual-hand-rigged-final/README.md`를 본다.

### 3. 실제 모터 제어

아직 구현 전이다. 앞으로 실제 전시용 손이 들어오면 `motor-control/` 아래에 다음 코드와 문서를 둔다.

- servo/motor/actuator 제어
- Arduino, RP2040, serial, BLE, CAN 등 하드웨어 통신
- 손가락별 calibration
- 정자세 복귀
- 안전 정지
- 웹앱 handState와 실제 모터 명령 연결

## 구현해야 할 부분

1. 발표 장비에서 Ollama 모델 설치와 응답 지연 재검증
2. 여러 관객이 동시에 slider를 움직일 때 transient bit가 너무 많이 쌓이면 300~500ms smoothing/debounce 추가
3. 5비트 자모 mapping 순서가 발표 관객에게 직관적인지 최종 확인
4. `/recognition`에 reset 버튼과 buffer clear 버튼 추가
5. 실제 전시용 모터 제어 폴더 구현
6. 웹앱 handState를 실제 모터 명령으로 변환하는 bridge 설계
7. `robot_hand_rig.glb`가 약 68MB이므로 장기적으로 Git LFS 전환 검토

## 검증 명령

Python:

```sh
.venv/bin/python -m compileall jamo-recognition/src
.venv/bin/acc-gesture --help
```

웹앱:

```sh
cd virtual-hand-rigged-final
npx tsc -p tsconfig.server.json --noEmit
npm run build
```

웹앱 API smoke test:

```sh
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/training-samples
curl http://127.0.0.1:3001/recognition-state
curl -X POST http://127.0.0.1:3001/word-correction \
  -H 'Content-Type: application/json' \
  -d '{"rawJamo":"ㅂㅕㅇㅊㅓㄴ"}'
```

## 문서 읽는 순서

1. `README.md`: 전체 프로젝트 지도
2. `HANDOFF.md`: 최신 진행상황과 다음 액션
3. `jamo-recognition/README.md`: Python 자모음 알고리즘 상세
4. `virtual-hand-rigged-final/README.md`: 발표용 웹앱 상세 운영법
5. `motor-control/README.md`: 실제 모터 제어 영역 계획

## Coordination

- 작업 시작 전 `git pull --rebase origin main`
- Python 환경 설치는 repo 루트에서 `.venv/bin/pip install -e jamo-recognition`
- 변경 후 관련 검증 명령 실행
- 문서와 코드 방향이 바뀌면 `HANDOFF.md`도 함께 업데이트
- `node_modules/`, `dist/`, `.venv/`, `data/` 산출물은 커밋하지 않음
