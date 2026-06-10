# HANDOFF

ACC GeSTure mock-up의 현재 상태를 팀원이 바로 이어받기 위한 문서다. 이 문서는 자모 인식 알고리즘과 가상 로봇손 웹앱을 분리해서 보지 않고, 전시 발표용 통합 흐름 기준으로 정리한다.

## 1. 현재 통합 방향

초기 목표는 카메라가 로봇손을 촬영하고 MediaPipe Hands가 21개 skeletal landmark를 뽑아 지화를 인식하는 방식이었다. 이후 팀원이 만든 `virtual-hand-rigged-final/` 웹앱이 합쳐지면서 현재 발표용 경로는 다음으로 바뀌었다.

```txt
관객 controller
  -> 웹앱 handState
  -> 5비트 자모 인식
  -> 자모 자동 누적
  -> 6개 자모 단위 Ollama LLM 단어 보정
  -> /display와 /recognition에 표시
```

카메라/MediaPipe 경로는 연구/비교용으로 유지한다. 가상 로봇손 렌더 화면을 캡처해서 MediaPipe에 넣는 실험은 실패했다. 손 전체가 보이도록 화면을 축소해도 `no hand detected`였다. 따라서 현재 발표용 입력은 화면 캡처가 아니라 handState와 GLB pivot 기반 virtual skeleton이다.

## 2. 현재 실행 화면

서버:

```powershell
cd C:\Users\kangm\Documents\ACC-project\virtual-hand-rigged-final
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
npm install
npm run build
npm start
```

발표용 화면:

```txt
로봇손 전시 화면: http://DEVICE_IP:3001/display
자모 추정 화면:   http://DEVICE_IP:3001/recognition
QR 링크 화면:     http://DEVICE_IP:3001/links
```

휴대폰으로 직접 조종하려면 `/links`를 `127.0.0.1`이 아니라 같은 네트워크의 테스트 노트북/디바이스 IP로 열어야 한다. QR도 이 IP 기준으로 생성되어야 한다.

```txt
http://DEVICE_IP:3001/links
```

## 3. 5비트 자모 인식 규칙

손가락 순서:

```txt
엄지 -> 검지 -> 중지 -> 약지 -> 소지
```

값 의미:

```txt
0~49    접힘 = 0
50~100  펴짐 = 1
```

자모 mapping:

```txt
0  ㄱ   1  ㄴ   2  ㄷ   3  ㄹ   4  ㅁ   5  ㅂ   6  ㅅ   7  ㅇ
8  ㅈ   9  ㅊ   10 ㅋ   11 ㅌ   12 ㅍ   13 ㅎ
14 ㅏ   15 ㅑ   16 ㅓ   17 ㅕ   18 ㅗ   19 ㅛ   20 ㅜ   21 ㅠ
22 ㅡ   23 ㅣ   24 ㅐ   25 ㅒ   26 ㅔ   27 ㅖ   28 ㅚ   29 ㅟ   30 ㅢ
31 rest pose, 모든 손가락 펴짐, 자모 입력 안 함
```

서버는 `31 labels x 24 samples = 744`개의 synthetic training sample을 생성한다. 열린 손가락은 `80~100`, 접힌 손가락은 `0~20` 범위에서 seed 고정 랜덤값으로 만든다. 실제 분류는 전시 입력 기준을 명확히 하기 위해 50 threshold 기반 5비트 판정을 우선 사용하고, nearest sample distance/confidence는 표시용으로 함께 제공한다.

## 4. 자동 입력과 단어 보정

기존 Python compose는 Enter로 현재 자모를 수동 입력하고 Tab으로 finalize했다. 현재 웹앱 발표 흐름은 다음으로 바뀌었다.

```txt
추정 자모가 바뀌면 자동 추가
현재 6개 buffer 안에 이미 들어간 자모는 중복 추가하지 않음
자모 buffer가 6개가 되면 자동으로 단어 보정
최종 단어는 /display의 AUTO WORD 카드에 표시
/recognition에는 현재 자모, bit, buffer, 보정 단어 표시
```

단어 보정은 더 이상 local vocabulary 고정 후보를 고르지 않는다. 서버가 Ollama `/api/chat`을 호출하고, LLM은 입력 자모의 순서 변경, 일부 삭제, 빠진 자모 보완을 허용해 1~4글자의 실제 한국어 단어 하나를 고른다. 최종 결과는 완성형 한글 1~4글자만 허용한다.

같은 자모는 rest pose(`11111`)를 거쳐도 현재 6개 buffer 안에서는 다시 입력하지 않는다. 즉, correction에 넘기는 6개 자모는 서로 중복되지 않는 것을 원칙으로 한다.

검증된 테스트:

```txt
ㄱㅏㅇㅅㅏㄴ -> compose 강산 -> correctedWord 강산
ㄱ, ㄱ, ㄴ -> buffer ㄱㄴ
ㅂㅕㅇㅊㅓㄴ -> compose 병천 -> correctedWord 친구
ㅂ, rest, ㅂ -> buffer ㅂ
```

## 5. 구현된 주요 파일

웹앱:

```txt
virtual-hand-rigged-final/server/binaryJamo.ts
  5비트 자모 mapping, synthetic sample 생성, Hangul compose, Ollama LLM word correction

virtual-hand-rigged-final/server/index.ts
  Express + Socket.IO server
  /hand-state
  /recognition-state
  /recognition/reset
  /word-correction
  /training-samples
  /virtual-skeleton

virtual-hand-rigged-final/client/src/pages/Display.tsx
  로봇손 표시, AUTO WORD 표시

virtual-hand-rigged-final/client/src/pages/Recognition.tsx
  현재 자모/bit/buffer/보정 단어 표시

virtual-hand-rigged-final/client/src/components/VirtualHand.tsx
  GLB 로봇손 로드, 손가락 pivot 회전, virtual skeleton 송신
```

Python:

```txt
jamo-recognition/src/gesture_pipeline/screen_check.py
  캡처 이미지에 MediaPipe Hands 검출을 실행

jamo-recognition/src/gesture_pipeline/virtual_skeleton.py
  웹앱 /virtual-skeleton을 읽어서 Python HandLandmarks로 변환

jamo-recognition/src/gesture_pipeline/cli.py
  screen-check, virtual-check, virtual-capture 명령 추가

jamo-recognition/src/gesture_pipeline/skeleton.py
  static_image_mode 옵션 추가
```

## 6. 검증된 명령

Python:

```powershell
.\.venv\Scripts\python.exe -m compileall jamo-recognition\src
```

웹앱:

```powershell
cd virtual-hand-rigged-final
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
npx tsc -p tsconfig.server.json --noEmit
npm run build
```

API 테스트:

```txt
/training-samples -> count 744
/recognition-state -> correctedWord 강산 테스트 성공
/word-correction rawJamo=ㅂㅕㅇㅊㅓㄴ -> correctedWord 친구 테스트 성공
/hand-state ㅂ, rest, ㅂ -> buffer ㅂ 테스트 성공
/display -> AUTO WORD 강산 표시 확인
/recognition -> corrected word 강산 표시 확인
```

## 7. 웹앱과 알고리즘 병합 이후 진행 내용

진행 순서:

```txt
1. virtual-hand-rigged-final 폴더를 확인하고 웹앱 구조 파악
2. 화면 캡처를 MediaPipe 입력처럼 넣는 실험 구현
3. 손 전체가 보이도록 zoom-out 캡처 후 MediaPipe 재검증
4. MediaPipe가 로봇손 렌더를 인식하지 못하는 것을 확인
5. GLB pivot/world position을 직접 읽는 virtual skeleton 경로 구현
6. Python에서 /virtual-skeleton을 읽는 virtual-check, virtual-capture 추가
7. 사용자가 새로 제안한 5비트 자모 체계 구현
8. synthetic sample 기반 training sample 생성
9. 자동 자모 누적, 중복 방지, 6개 자모 단어 보정 구현
10. /recognition 발표용 모니터 화면 추가
11. /display에 최종 단어 표시 추가
12. README 통합 정리
13. HANDOFF 통합 정리
```

중요한 설계 결정:

```txt
화면 캡처 기반 MediaPipe 인식은 발표용 주 경로로 쓰지 않는다.
로봇손 웹앱의 handState는 5비트 자모 인식의 직접 입력으로 쓴다.
GLB pivot 기반 virtual skeleton은 Python skeletal pipeline과 연결 가능한 보조/확장 경로로 유지한다.
모든 손가락이 펴진 11111은 rest pose로 두어 기본 상태가 계속 글자를 입력하지 않게 한다.
```

## 8. 현재 남은 이슈

1. 5비트 mapping 순서가 발표 관객에게 직관적인지 최종 확인해야 한다.
2. 관객 여러 명이 동시에 slider를 움직이면 transient bit 변화가 빠르게 쌓일 수 있다. 필요하면 300~500ms smoothing/debounce를 추가한다.
3. Ollama LLM 보정은 로컬 서버와 모델 상태에 의존한다. 발표 장비에서 모델 설치, 응답 지연, fallback 동작을 다시 확인해야 한다.
4. `robot_hand_rig.glb`가 약 68MB라 GitHub가 LFS 사용을 권장한다. 현재 push는 성공했지만 장기적으로 Git LFS 전환을 검토한다.

## 9. Git 상태 메모

마지막으로 push한 커밋:

```txt
21c7e6f Add virtual hand binary jamo demo
```

이 커밋은 `HANDOFF.md`를 삭제한 상태였으므로, 현재 문서 수정에서는 `HANDOFF.md`를 다시 추가해야 한다.

## 10. 다음 작업 제안

1. `/links`를 노트북 IP로 열고 실제 휴대폰 5대로 조종 테스트.
2. 발표 장비에서 `qwen2.5:7b-instruct` 또는 목표 모델로 `/word-correction` 지연과 결과 품질을 확인.
3. 필요하면 `/recognition`에 reset 버튼과 buffer clear 버튼 추가.
4. 여러 손가락 동시 이동 중 자동 입력이 너무 민감하면 debounce 구현.

## 11. 2026-06-10 문서/폴더 구조 정리

루트 `README.md`를 프로젝트 전체 지도 문서로 재작성했다. 이제 루트 README는 전체 맥락, 시각적인 폴더 구조, 구현된 부분, 구현해야 할 부분, 검증 명령을 먼저 보여준다.

현재 영역 구분:

```txt
jamo-recognition/          Python 자모음 알고리즘/MediaPipe/skeleton 실험
virtual-hand-rigged-final/ 발표용 가상 로봇손 웹앱
motor-control/             실제 전시용 모터 제어 예정 영역
data/                      로컬 캡처/JSONL 실행 산출물
```

`motor-control/README.md`를 placeholder로 추가했다. 아직 실제 모터 제어 코드는 없고, actuator/controller 확정 후 firmware, protocol bridge, calibration, emergency stop, neutral pose 복귀 기능을 이 폴더에 넣는 방향으로 정리했다.

## 12. 2026-06-10 jamo-recognition 폴더 분리

Python 자모음 알고리즘을 루트 `src/`, `docs/`, `pyproject.toml` 구조에서 `jamo-recognition/` 영역으로 이동했다. 이제 Python 패키지, 알고리즘 문서, 기준 reference sample은 한 폴더 안에서 관리한다.

현재 Python 영역:

```txt
jamo-recognition/
  README.md
  pyproject.toml
  src/gesture_pipeline/
  data/reference_samples.jsonl
  docs/algorithm_plan.md
```

repo 루트에서 설치:

```powershell
.\.venv\Scripts\pip.exe install -e jamo-recognition
```

macOS/Linux:

```sh
.venv/bin/pip install -e jamo-recognition
```

`acc-gesture recognize`, `compose`, `capture`, `run`, `virtual-check`의 기본 reference path는 `jamo-recognition/data/reference_samples.jsonl`로 바뀌었다. 실행 로그와 임시 캡처 파일은 계속 루트 `data/`에 둘 수 있다.

## 13. 2026-06-10 웹앱 LLM 보정 중복 호출 방지

웹앱에서 6개 자모가 모인 순간 화면이 멈춘 것처럼 보이는 문제가 있었다. 원인은 LLM 보정 요청이 진행 중인 동안 손가락 update 이벤트가 계속 들어오면서 `updateRecognitionState()`가 같은 6개 자모를 여러 번 보정 요청하는 구조였다.

수정 내용:

```txt
correctionInFlight flag 추가
보정 중에는 새 LLM correction을 시작하지 않음
보정에 넘긴 6개 token은 즉시 buffer에서 분리
reset 시 correctionInFlight도 함께 초기화
```

이제 6개 자모 단위 correction은 한 번만 실행되며, 중복 `correctedWords` 누적을 막는다. LLM 자체 응답 시간은 모델/장비 상태에 따라 몇 초 이상 걸릴 수 있지만, 같은 correction이 동시에 여러 번 쌓이는 문제는 줄였다.

## 14. 2026-06-10 LLM 출력 단어 범위 조정

`병천`처럼 실제 단어 또는 지명일 수 있지만 전시 관객이 바로 의미를 떠올리기 어려운 결과가 나왔다. 아직 whitelist를 만들지는 않고, 먼저 Ollama 프롬프트를 강화하는 방향으로 조정했다.

변경 방향:

```txt
결과 단어는 1~4글자의 쉽고 일상적인 한국어 단어로 제한
감정, 사물, 자연, 관계, 몸, 간단한 행동 관련 단어 우선
지명, 인명, 고유명사, 전문용어, 옛말, 드문 한자어, 의미가 모호한 단어 금지
semantic check와 repair prompt에도 같은 기준 적용
```

현재 목표는 LLM이 깨진 자모 입력을 정확히 받아쓰기처럼 복원하는 것이 아니라, 모두가 이해할 수 있는 전시용 의미 단어로 해석하게 만드는 것이다.

## 15. 2026-06-10 웹앱 손가락 표기 정리

웹앱에서 다섯 번째 손가락 표시를 `새끼`에서 `소지`로 바꿨다. 전시 화면과 조종 화면에서 더 단정하고 공식적인 표현을 쓰기 위한 변경이다.

또한 각 손가락 controller 화면 하단의 설명 문구를 제거했다. controller 화면은 손가락 이름, 현재 값, slider만 보이도록 단순화했다.

## 16. 2026-06-10 자모 buffer 중복 입력 방지 강화

기존에는 직전 자모와 같은 경우만 중복 입력을 막았다. 이 때문에 rest pose를 거치면 같은 자모가 현재 buffer에 다시 들어갈 수 있었다.

새 정책:

```txt
현재 6개 buffer 안에 이미 들어간 자모는 다시 입력하지 않는다.
rest pose를 거쳐도 같은 buffer 안에서는 동일 자모를 다시 추가하지 않는다.
LLM correction에 넘기는 6개 자모는 서로 중복되지 않는 것을 원칙으로 한다.
```

중복 자모가 들어오면 `/recognition` note에 duplicate ignored 상태를 표시하고 buffer는 그대로 유지한다.
