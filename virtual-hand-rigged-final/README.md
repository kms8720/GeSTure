# Virtual Hand Rigged Final

ACC GeSTure 발표/전시용 가상 로봇손 웹앱이다. 여러 관객이 각자 손가락 하나를 조종하고, 서버가 5개 손가락 상태를 5비트 자모 입력으로 해석한다. 로봇손 화면에는 최종 보정 단어가 표시되고, 별도 recognition 화면에는 현재 skeletal/bit 기반 추정 상태가 표시된다.

## 핵심 규칙

손가락 순서는 항상 다음과 같다.

```txt
엄지 -> 검지 -> 중지 -> 약지 -> 소지
```

각 손가락은 2진수 한 자리로 본다.

```txt
0~49  = 접힘 = 0
50~100 = 펴짐 = 1
```

웹 슬라이더 값도 같은 의미를 쓴다.

```txt
0   = 완전히 접힌 상태
100 = 완전히 편 상태
```

5비트 값 `0~30`은 31개 자모에 대응한다. `31`, 즉 모든 손가락이 펴진 `11111`은 대기/rest pose로 남겨두고 자모로 입력하지 않는다.

```txt
0  ㄱ   1  ㄴ   2  ㄷ   3  ㄹ   4  ㅁ   5  ㅂ   6  ㅅ   7  ㅇ
8  ㅈ   9  ㅊ   10 ㅋ   11 ㅌ   12 ㅍ   13 ㅎ
14 ㅏ   15 ㅑ   16 ㅓ   17 ㅕ   18 ㅗ   19 ㅛ   20 ㅜ   21 ㅠ
22 ㅡ   23 ㅣ   24 ㅐ   25 ㅒ   26 ㅔ   27 ㅖ   28 ㅚ   29 ㅟ   30 ㅢ
```

서버는 각 label마다 seed 고정 synthetic sample 24개를 만든다. 열린 손가락은 `80~100`, 접힌 손가락은 `0~20` 사이 랜덤값으로 생성해서 총 `31 x 24 = 744`개 training sample을 가진다. 판정은 전시 입력 기준을 지키기 위해 `50` threshold 기반 5비트 분류를 우선 사용하고, sample 기반 nearest distance/confidence를 함께 표시한다.

## 화면

```txt
/display      로봇손 전시 화면. 최종 보정 단어가 한켠에 표시된다.
/recognition  현재 5비트, 추정 자모, 자동 입력 버퍼, 보정 단어를 보여준다.
/links        손가락별 controller QR/link 화면.
/control/...  손가락 하나를 조종하는 관객용 화면.
```

발표 때는 보통 `/display`와 `/recognition` 두 창을 나란히 띄운다.

## 실행

Windows PowerShell:

```powershell
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
npm install
npm run build
npm start
```

접속:

```txt
Display:           http://DEVICE_IP:3001/display
Recognition:       http://DEVICE_IP:3001/recognition
Links:             http://DEVICE_IP:3001/links
Health:            http://DEVICE_IP:3001/health
Hand state:        http://DEVICE_IP:3001/hand-state
Recognition state: http://DEVICE_IP:3001/recognition-state
Training samples:  http://DEVICE_IP:3001/training-samples
Virtual skeleton:  http://DEVICE_IP:3001/virtual-skeleton
```

휴대폰 QR을 쓰려면 `/links`를 `127.0.0.1`이나 `localhost`가 아니라 같은 네트워크의 테스트 노트북/디바이스 IP로 열어야 한다. Mac에서는 보통 다음으로 IP를 확인한다.

```sh
ipconfig getifaddr en0
```

예:

```txt
http://192.168.0.129:3001/links
```

실수로 `127.0.0.1:3001/links`를 열어도 `/links` 화면의 QR은 서버가 찾은 LAN IP를 우선 사용해 생성한다.

## 데이터 흐름

```txt
/control/:finger slider
  -> Socket.IO finger:update
  -> server handState update
  -> binary jamo prediction
  -> recognition:state broadcast
  -> /display, /recognition update
  -> /display VirtualHand.tsx GLB pivot rotation
  -> GLB pivot/world position extraction
  -> Socket.IO virtual:skeleton
  -> server latestVirtualSkeleton update
```

자모가 이전 자모와 다를 때만 자동으로 buffer에 추가된다. 같은 자모를 다시 입력해야 하면 모든 손가락을 편 `11111` rest pose를 한 번 거치면 된다. buffer가 6개가 되면 서버가 Hangul compose를 시도한 뒤, Ollama LLM에 `rawJamo`와 `composedText`를 보내 1~4글자의 의미 있는 한국어 단어로 보정한다. 이때 LLM은 자모 순서 변경, 일부 삭제, 중복 병합을 허용한다. 최신 보정 단어는 `/display`의 `AUTO WORD` 카드에 표시된다.

## 검증 예시

`ㄱㅏㅇㅅㅏㄴ` 여섯 자모를 임의값으로 넣으면 `강산`으로 보정된다. 이 테스트는 딱 `0`/`100`이 아니라 `55~96` 열린 값과 `8~44` 접힌 값을 섞어서 threshold가 동작하는지 확인했다.

```txt
trainingCount: 744
samplesPerLabel: 24
rawJamo: ㄱㅏㅇㅅㅏㄴ
composedText: 강산
correctedWord: 강산
finalized: true
```

자모 순서 재배열/중복 처리 테스트도 통과했다.

```txt
rawJamo: ㅏㅐㅂㅂㅏㅇ
composedText: ㅏㅐㅂ방
correctedWord: 방법
```

중복 방지 테스트도 통과했다.

```txt
ㄱ 상태 입력
ㄱ 상태 다시 입력
ㄴ 상태 입력
결과 buffer: ㄱㄴ

ㅂ 상태 입력
rest 상태 입력
ㅂ 상태 입력
결과 buffer: ㅂㅂ
```

## Virtual skeleton 경로

`VirtualHand.tsx`는 로봇손 GLB 안의 pivot object 위치를 매 프레임 읽어서 MediaPipe와 같은 21개 landmark 배열로 만든다. 서버는 가장 최근 skeleton을 `/virtual-skeleton`에서 반환한다.

```json
{
  "ok": true,
  "skeleton": {
    "source": "virtual-hand-rigged-final",
    "handedness": "Right",
    "points": [[0, 0, 0]],
    "timestamp": "2026-06-08T00:00:00.000Z"
  }
}
```

Python 쪽에서는 이 값을 `acc-gesture virtual-check`와 `acc-gesture virtual-capture`로 읽을 수 있다.

```powershell
.\.venv\Scripts\acc-gesture.exe virtual-check --url http://127.0.0.1:3001/virtual-skeleton --no-recognizer
.\.venv\Scripts\acc-gesture.exe virtual-capture --label test_open --url http://127.0.0.1:3001/virtual-skeleton --samples 5 --interval 0.1 --output data\virtual_reference_samples_test.jsonl
```

## 화면 캡처 실험

가상 화면을 실제 카메라 프레임처럼 Python MediaPipe에 넣어보기 위한 캡처 스크립트도 남겨둔다.

```powershell
npm run capture:display -- --url http://127.0.0.1:3001/display --socket http://127.0.0.1:3001 --pose open --width 1280 --height 1200 --zoom-out-steps 6 --out ../data/virtual_hand_open_zoomout.png
.\.venv\Scripts\acc-gesture.exe screen-check --image data\virtual_hand_open_zoomout.png --save-overlay data\virtual_hand_open_zoomout_overlay.png --min-detection-confidence 0.1
```

2026-06-08 검증 결과, 손 전체가 보이도록 축소해도 MediaPipe Hands는 현재 로봇손 GLB 렌더 이미지를 사람 손으로 인식하지 못했다. 따라서 발표용 알고리즘 입력은 화면 캡처가 아니라 5비트 handState와 GLB pivot 기반 virtual skeleton을 우선 사용한다.

## 폴더 구조

```txt
virtual-hand-rigged-final/
  client/src/
    components/VirtualHand.tsx       # GLB 로봇손, pivot 회전, virtual skeleton 송신
    components/FingerController.tsx  # 손가락별 slider
    pages/Display.tsx                # 전시 화면
    pages/Recognition.tsx            # 자모 추정 모니터
    pages/Links.tsx                  # controller QR/link
    socket/types.ts                  # HandState, RecognitionState 타입
    styles/global.css
  public/models/robot_hand_rig.glb
  scripts/capture-display.mjs
  server/binaryJamo.ts               # 5비트 자모 매핑, sample 생성, compose/correction
  server/index.ts                    # Express + Socket.IO server
```

커밋하지 않는 생성물:

```txt
node_modules/
dist/
*.log
.DS_Store
```

## Blender 모델 메모

웹 코드가 찾는 pivot 이름:

```txt
palm_wrist
thumb_base_pivot
thumb_tip_pivot
index_base_pivot
index_middle_pivot
index_tip_pivot
middle_base_pivot
middle_middle_pivot
middle_tip_pivot
ring_base_pivot
ring_middle_pivot
ring_tip_pivot
pinky_base_pivot
pinky_middle_pivot
pinky_tip_pivot
```

움직이고 싶은 기준점은 Empty pivot이고, 움직여야 하는 mesh는 pivot의 자식이어야 한다.

## 다음 개선 후보

1. 5비트 mapping을 전시에서 읽기 쉬운 순서로 조정할지 최종 결정.
2. Ollama LLM 보정 지연과 실패 fallback을 발표 장비에서 재검증.
3. 여러 관객이 동시에 slider를 움직일 때 생기는 transient bit 변화를 smoothing.
4. virtual skeleton 좌표 자체를 이용한 confidence/rule을 추가.
