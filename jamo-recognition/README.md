# Jamo Recognition

카메라/MediaPipe 기반 자모음 인식 알고리즘과 Python 실험 코드가 들어 있는 영역이다. 현재 발표용 주 경로는 `../virtual-hand-rigged-final/` 웹앱이지만, 이 폴더는 실제 카메라, skeleton, reference sample, Python Ollama compose 실험을 유지한다.

## 역할

```txt
camera frame
  -> MediaPipe Hands 21 landmarks
  -> skeleton normalization
  -> reference-sample nearest recognizer
  -> jamo prediction
  -> Hangul compose / Ollama word correction experiment
```

웹앱의 virtual skeleton API도 이 Python 파이프라인에서 읽을 수 있다.

```txt
webapp /virtual-skeleton
  -> acc-gesture virtual-check
  -> acc-gesture virtual-capture
```

## 폴더 구조

```txt
jamo-recognition/
├── README.md
├── pyproject.toml
├── src/
│   └── gesture_pipeline/
│       ├── cli.py
│       ├── camera.py
│       ├── skeleton.py
│       ├── recognizer.py
│       ├── hangul.py
│       ├── llm.py
│       ├── live_recognition.py
│       ├── live_compose.py
│       ├── screen_check.py
│       └── virtual_skeleton.py
├── data/
│   └── reference_samples.jsonl
└── docs/
    └── algorithm_plan.md
```

## 설치

repo 루트에서 실행:

```sh
python3 -m venv .venv
.venv/bin/pip install -e jamo-recognition
```

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\pip.exe install -e jamo-recognition
```

Python 버전은 3.10, 3.11, 3.12를 사용한다. `mediapipe==0.10.14`가 legacy `mp.solutions.hands` API를 제공하기 때문에 현재 extractor와 맞다.

## 주요 명령

repo 루트에서 실행:

```sh
.venv/bin/acc-gesture check --no-camera
.venv/bin/acc-gesture preview --camera 0
.venv/bin/acc-gesture recognize --camera 0 --references jamo-recognition/data/reference_samples.jsonl
.venv/bin/acc-gesture compose --camera 0 --references jamo-recognition/data/reference_samples.jsonl --output data/compose_session.jsonl
.venv/bin/acc-gesture screen-check --image data/virtual_hand_open_zoomout.png --save-overlay data/virtual_hand_open_zoomout_overlay.png
.venv/bin/acc-gesture virtual-check --url http://127.0.0.1:3001/virtual-skeleton --no-recognizer
.venv/bin/acc-gesture virtual-capture --label test_open --url http://127.0.0.1:3001/virtual-skeleton --samples 5 --output data/virtual_reference_samples.jsonl
```

## 구현된 부분

- OpenCV camera open/check/preview
- MediaPipe Hands landmark extraction
- skeleton normalization
- labeled reference skeleton capture
- reference sample nearest recognizer
- live recognition overlay
- live compose mode
- Python Ollama word correction experiment
- captured screen image MediaPipe check
- webapp `/virtual-skeleton` fetch/check/capture

## 아직 남은 부분

1. 실제 로봇손/전시 손 기준 reference sample 재수집
2. confidence threshold와 repeated-frame smoothing
3. 카메라 위치/조명 변화에 대한 calibration
4. Python 경로와 발표용 웹앱 경로의 역할 분리 유지
5. 필요하면 MediaPipe Tasks API로 extractor migration

## 검증

```sh
.venv/bin/python -m compileall jamo-recognition/src
.venv/bin/acc-gesture --help
```
