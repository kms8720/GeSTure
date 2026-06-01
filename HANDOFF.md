# HANDOFF

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
