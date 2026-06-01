# HANDOFF

## 2026-06-01 Seoul - desktop follow-up after macOS Python 3.13 blocker

### What changed

- Set the supported Python range in `pyproject.toml` to `>=3.10,<3.13`.
- Pinned `mediapipe==0.10.14`, because `mediapipe 0.10.35` also lacks `mp.solutions` in this environment.
- Updated `acc-gesture check` so unsupported Python versions fail with a direct message.
- Updated MediaPipe import diagnostics to detect when `mp.solutions` is missing.
- Added a clearer runtime error in `MediaPipeHandExtractor` for missing legacy MediaPipe Hands API.
- Updated `README.md` to tell macOS/desktop users to use Python 3.10, 3.11, or 3.12.

### Why

The macOS check showed Python 3.13 installs a MediaPipe wheel where `mediapipe.solutions` is unavailable. A follow-up on Windows showed `mediapipe 0.10.35` also lacks `mp.solutions`, while `mediapipe 0.10.14` restores it. For the mock-up stage, staying on the legacy Hands API is the fastest path.

### Commands run on Windows desktop

```powershell
.\.venv\Scripts\python.exe -m compileall src
.\.venv\Scripts\acc-gesture.exe check --no-camera
.\.venv\Scripts\acc-gesture.exe check --scan-cameras --max-camera-index 1 --camera 0
```

### Result

- Compile check passed.
- Environment check passed on Python 3.11.9 after downgrading to `mediapipe 0.10.14`.
- Camera scan on this Windows desktop reported camera indices 0 and 1 unavailable, so camera/skeleton capture should be re-tested on the MacBook or camera-equipped laptop.

### Next concrete task

On the MacBook, recreate the virtualenv with Python 3.11 or 3.12 so the new dependency pin installs `mediapipe 0.10.14`, then re-run:

```sh
python3.11 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/acc-gesture check --no-camera
.venv/bin/acc-gesture check --scan-cameras --max-camera-index 3
.venv/bin/acc-gesture check --camera 0 --save-frame data/check_frame.jpg
```

## 2026-06-01 Seoul - desktop skeleton preview command

### What changed

- Added `acc-gesture preview --camera 0` for a live OpenCV window with hand skeleton points and lines.
- Added shared overlay drawing in `src/gesture_pipeline/overlay.py`.
- Updated the normal `acc-gesture run` preview so sampled frames also show the detected skeleton overlay.

### Commands to run on the MacBook

```sh
.venv/bin/acc-gesture preview --camera 0
```

Press `q` in the preview window to stop. The expected display is the camera feed with green hand lines, blue/orange landmark dots, and a `hand: Left` or `hand: Right` label. If no hand is found, the window shows `no hand detected`.

## 2026-06-01 Seoul - local verification on this desktop

### Context

This repository is being worked on from more than one desktop. Use this file to leave concise state for the next Codex/user session before pushing or switching machines.

### Commands run

```sh
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/acc-gesture check --no-camera
.venv/bin/acc-gesture check --scan-cameras --max-camera-index 3
.venv/bin/acc-gesture check --camera 0 --save-frame data/check_frame.jpg
```

### Result

- Clone, virtualenv creation, and editable install succeeded.
- `acc-gesture check --no-camera` succeeded.
- Camera frame capture appears to work on camera index 0.
- `data/check_frame.jpg` was saved locally during the camera check.
- Camera checks fail when the pipeline initializes MediaPipe hand extraction.

### Environment observed

- Python: `3.13.3`
- OpenCV: `4.13.0`
- MediaPipe: `0.10.35`
- NumPy: `2.4.6`
- Pydantic: `2.13.4`
- OS: macOS / Darwin

### Current blocker

The code in `src/gesture_pipeline/skeleton.py` uses the legacy MediaPipe API:

```python
mp.solutions.hands.Hands(...)
```

However, the MediaPipe wheels available for Python 3.13 expose `Image`, `ImageFormat`, and `tasks`, but not `solutions`. The failure is:

```text
AttributeError: module 'mediapipe' has no attribute 'solutions'
```

Downgrading to `mediapipe==0.10.30` on Python 3.13 did not restore `mp.solutions`.

### Suggested next steps

1. Decide whether the project should target a Python version with legacy `mp.solutions` support, or migrate the implementation to MediaPipe Tasks.
2. If keeping `mp.solutions`, test with Python 3.10 or 3.11 and pin compatible dependency versions in `pyproject.toml`.
3. If migrating, update `MediaPipeHandExtractor` to use the current `mediapipe.tasks` hand landmarker API and add a focused test or diagnostic path.
4. Re-run:

```sh
.venv/bin/acc-gesture check --no-camera
.venv/bin/acc-gesture check --scan-cameras --max-camera-index 3
.venv/bin/acc-gesture check --camera 0 --save-frame data/check_frame.jpg
```

### Coordination notes

- Before starting work on another desktop, run `git pull --rebase`.
- Before stopping work, update this file with:
  - what changed,
  - what was tested,
  - what still fails,
  - the next concrete task.
- Commit code and handoff updates together when they describe the same change.
