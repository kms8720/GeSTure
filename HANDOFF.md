# HANDOFF

## Project Overview - Read This First

### Goal

ACC GeSTure mock-up algorithm for the exhibition project. A robot hand will be filmed by a camera about once per second. The software should extract skeletal hand landmarks, recognize Korean fingerspelling jamo from the pose, store the recognized consonants/vowels/words, and later pass accumulated text to an LLM/display pipeline for exhibition output.

### Current Scope

This repository currently covers the vision/skeleton side of the mock-up:

1. Open a camera.
2. Sample frames or stream frames.
3. Extract 21 hand landmarks with MediaPipe Hands.
4. Normalize the skeleton so camera placement matters less.
5. Save timestamped placeholder jamo predictions to JSONL.
6. Show live skeleton overlays for human verification.

### Environment Decision

- Use Python 3.10, 3.11, or 3.12.
- `mediapipe==0.10.14` is pinned because it exposes the legacy `mp.solutions.hands` API used by the current extractor.
- Python 3.13 and newer MediaPipe wheels may lack `mp.solutions`; avoid them for now unless the extractor is migrated to MediaPipe Tasks.

### Implemented

- Python package scaffold and CLI entrypoint: `acc-gesture`.
- `acc-gesture check --no-camera` for environment verification.
- `acc-gesture check --scan-cameras --max-camera-index 3` for camera index discovery.
- `acc-gesture check --camera 0 --duration 3 --preview --save-frame ...` for streamed camera/skeleton verification.
- `acc-gesture preview --camera 0` for live skeleton overlay viewing.
- `acc-gesture run --camera 0 --interval 1.0 --output data/session.jsonl` for 1-second sampling and JSONL storage.
- MediaPipe hand landmark extraction through `MediaPipeHandExtractor`.
- Skeleton normalization around wrist, scale, and palm rotation.
- Placeholder recognizer that still needs real jamo logic.
- JSONL session storage.
- Handoff workflow between Windows desktop and MacBook.

### Verified

- Windows desktop:
  - Python 3.11.9 environment works.
  - `mediapipe==0.10.14` exposes `mp.solutions`.
  - Compile and no-camera diagnostics pass.
  - No usable camera is attached to this desktop.
- MacBook:
  - Python 3.10.5 environment works.
  - Camera index 0 opens.
  - Streamed camera preview works.
  - Skeleton detection succeeded with `Left, landmarks=21`.

### Not Implemented Yet

- Real Korean jamo recognition rules/model.
- Jamo confidence thresholds and repeated-frame smoothing.
- Composition from jamo candidates into syllables/words.
- Dataset capture workflow for labeling robot-hand poses.
- Arduino/Bluetooth/controller signal handling for the robot hand.
- LLM sentence generation from stored words/jamo.
- Exhibition display output for text/images/animation.
- Autonomous robot-hand motion and return-to-neutral behavior.

### Next Recommended Work

1. On the MacBook, run `acc-gesture preview --camera 0` and visually confirm that the skeleton lines are stable for the robot hand, not only a human hand.
2. Capture reference frames for the first small jamo set, for example `giyeok`, `nieun`, `digeut`, `a`, and `eo`.
3. Implement the first recognizer pass as simple landmark-angle/distance rules before training a model.
4. Add smoothing so one unstable frame does not immediately become a letter.
5. Update this file before switching machines, then commit and push.

### Coordination Rules

- Before starting on any machine: `git pull --rebase origin main`.
- After changing code: run the relevant check command, update this file, commit, and push.
- Keep hardware-specific observations here, especially camera index, Python version, and whether skeleton detection worked.

## Chronological Notes

## 2026-06-01 Seoul - MacBook camera 0 stream verification

### What was tested

- Recreated `.venv` with Python 3.10.5 after pulling the latest `origin/main`.
- Installed the project with `mediapipe==0.10.14`.
- Added a 3-second stream mode to `acc-gesture check` so the user can see live video while multiple frames are sampled.
- Verified camera index 0 as the working camera path for this MacBook.

### Commands run

```sh
rm -rf .venv
/Library/Frameworks/Python.framework/Versions/3.10/bin/python3.10 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/acc-gesture check --no-camera
.venv/bin/acc-gesture check --scan-cameras --max-camera-index 3
.venv/bin/acc-gesture check --camera 0 --duration 3 --preview --save-frame data/check_frame_camera0_stream.jpg
```

### Result

- `check --no-camera` passed on Python 3.10.5.
- `mediapipe 0.10.14` restored the legacy `mp.solutions` API path.
- Camera index 0 opens and captures real video frames.
- The 3-second stream check displayed live preview and sampled 43 frames.
- Hand skeleton detection succeeded on camera index 0:
  - `hand_skeleton: Left, landmarks=21`
  - saved `data/check_frame_camera0_stream.jpg`

### Notes

- Use camera index 0 as the default path for this MacBook.
- Prefer the new stream check over a single-frame check during manual testing:

```sh
.venv/bin/acc-gesture check --camera 0 --duration 3 --preview --save-frame data/check_frame_camera0_stream.jpg
```

- Ask the user to hold an open palm steady in the center of the frame before running the command.

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

### Current blocker - resolved by later notes

The code in `src/gesture_pipeline/skeleton.py` uses the legacy MediaPipe API:

```python
mp.solutions.hands.Hands(...)
```

However, the MediaPipe wheels available for Python 3.13 expose `Image`, `ImageFormat`, and `tasks`, but not `solutions`. The failure is:

```text
AttributeError: module 'mediapipe' has no attribute 'solutions'
```

Downgrading to `mediapipe==0.10.30` on Python 3.13 did not restore `mp.solutions`. Later work resolved the project path by using Python 3.10-3.12 and pinning `mediapipe==0.10.14`.

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
