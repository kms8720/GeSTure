# HANDOFF

ACC GeSTure mock-up의 현재 상태를 팀원이 바로 이어받기 위한 문서다. 이 문서는 자모 인식 알고리즘과 가상 로봇손 웹앱을 분리해서 보지 않고, 전시 발표용 통합 흐름 기준으로 정리한다.

## 1. 현재 통합 방향

초기 목표는 카메라가 로봇손을 촬영하고 MediaPipe Hands가 21개 skeletal landmark를 뽑아 지화를 인식하는 방식이었다. 이후 팀원이 만든 `virtual-hand-rigged-final/` 웹앱이 합쳐지면서 현재 발표용 경로는 다음으로 바뀌었다.

```txt
관객 controller
  -> 웹앱 handState
  -> 5비트 자모 인식
  -> 자모 자동 누적
  -> 6개 자모 단위 단어 보정
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
로봇손 전시 화면: http://127.0.0.1:3001/display
자모 추정 화면:   http://127.0.0.1:3001/recognition
QR 링크 화면:     http://127.0.0.1:3001/links
```

휴대폰으로 직접 조종하려면 `/links`를 `127.0.0.1`이 아니라 같은 네트워크의 노트북 IP로 열어야 한다.

```txt
http://노트북_IP:3001/links
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
같은 자모가 연속으로 유지되면 중복 추가하지 않음
자모 buffer가 6개가 되면 자동으로 단어 보정
최종 단어는 /display의 AUTO WORD 카드에 표시
/recognition에는 현재 자모, bit, buffer, 보정 단어 표시
```

검증된 테스트:

```txt
ㄱㅏㅇㅅㅏㄴ -> compose 강산 -> correctedWord 강산
ㄱ, ㄱ, ㄴ -> buffer ㄱㄴ
```

## 5. 구현된 주요 파일

웹앱:

```txt
virtual-hand-rigged-final/server/binaryJamo.ts
  5비트 자모 mapping, synthetic sample 생성, Hangul compose, local word correction

virtual-hand-rigged-final/server/index.ts
  Express + Socket.IO server
  /hand-state
  /recognition-state
  /recognition/reset
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
src/gesture_pipeline/screen_check.py
  캡처 이미지에 MediaPipe Hands 검출을 실행

src/gesture_pipeline/virtual_skeleton.py
  웹앱 /virtual-skeleton을 읽어서 Python HandLandmarks로 변환

src/gesture_pipeline/cli.py
  screen-check, virtual-check, virtual-capture 명령 추가

src/gesture_pipeline/skeleton.py
  static_image_mode 옵션 추가
```

## 6. 검증된 명령

Python:

```powershell
.\.venv\Scripts\python.exe -m compileall src
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
3. local word correction vocabulary는 현재 전시 테스트용이다. 발표에서 보여줄 단어 후보를 더 넣어야 한다.
4. `robot_hand_rig.glb`가 약 68MB라 GitHub가 LFS 사용을 권장한다. 현재 push는 성공했지만 장기적으로 Git LFS 전환을 검토한다.

## 9. Git 상태 메모

마지막으로 push한 커밋:

```txt
21c7e6f Add virtual hand binary jamo demo
```

이 커밋은 `HANDOFF.md`를 삭제한 상태였으므로, 현재 문서 수정에서는 `HANDOFF.md`를 다시 추가해야 한다.

## 10. 다음 작업 제안

1. `/links`를 노트북 IP로 열고 실제 휴대폰 5대로 조종 테스트.
2. 발표에서 보여줄 단어 5~10개를 정하고 local vocabulary에 추가.
3. 필요하면 `/recognition`에 reset 버튼과 buffer clear 버튼 추가.
4. 여러 손가락 동시 이동 중 자동 입력이 너무 민감하면 debounce 구현.
