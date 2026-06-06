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
- `acc-gesture capture --label giyeok --camera 0 --samples 20` for labeled reference skeleton capture.
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
- Batch capture planning for the full jamo set and repeat sessions.
- Arduino/Bluetooth/controller signal handling for the robot hand.
- LLM sentence generation from stored words/jamo.
- Exhibition display output for text/images/animation.
- Autonomous robot-hand motion and return-to-neutral behavior.

### Next Recommended Work

1. On the MacBook, run `acc-gesture preview --camera 0` and visually confirm that the skeleton lines are stable for the robot hand, not only a human hand.
2. On the MacBook, capture reference frames for the first small jamo set, for example `giyeok`, `nieun`, `digeut`, `a`, and `eo`.
3. Implement the first recognizer pass using the saved reference skeletons before training a model.
4. Add smoothing so one unstable frame does not immediately become a letter.
5. Update this file before switching machines, then commit and push.

### Coordination Rules

- Before starting on any machine: `git pull --rebase origin main`.
- After changing code: run the relevant check command, update this file, commit, and push.
- Keep hardware-specific observations here, especially camera index, Python version, and whether skeleton detection worked.

## Chronological Notes

## 2026-06-06 Seoul - compose manual window verification attempt

### What happened

- Relaunched the compose window with the real Ollama development model:

```sh
.venv/bin/acc-gesture compose --camera 0 --references data/reference_samples.jsonl --output data/compose_session.jsonl --llm-model qwen2.5:7b-instruct
```

### Observed

- Loaded 620 reference samples.
- Camera index 0 opened successfully.
- Compose window printed the expected controls:
  - Enter commits current jamo.
  - Backspace deletes.
  - Tab finalizes.
  - Space stops.
- No new key events were written to `data/compose_session.jsonl` during this unattended run.
- The process was stopped with Ctrl-C from the terminal, so this attempt does not count as the manual Tab/overlay verification.

### Status

- Automated Ollama finalize JSONL integration is verified with `llm.status=ok`.
- Remaining manual check: focus the OpenCV compose window, press Enter for one or more jamo, press Tab, confirm corrected text appears on the overlay, then press Space and inspect the latest `finalize` event in `data/compose_session.jsonl`.

### Follow-up autokey attempt

- Tried a separate compose run with `data/compose_session_autokey.jsonl` and attempted to send `Enter`, `Tab`, and `Space` through macOS `System Events`.
- AppleScript/System Events did not return successfully and no autokey JSONL log was created.
- The compose process was stopped with Ctrl-C after confirming camera 0 opened and the overlay loop was running.
- This means the remaining verification genuinely requires a focused OpenCV window and human key input, or a future code-level test hook for scripted key events.

## 2026-06-06 Seoul - Ollama development model verification on MacBook

### What changed

- Installed Ollama for local development verification on the MacBook M1 Pro 16GB.
- Initial `brew install ollama` installed formula version `0.30.6`, but model inference failed with HTTP 500 because `llama-server` was missing from the formula package.
- Replaced it with the macOS app cask:
  - `brew uninstall ollama`
  - `brew install --cask ollama-app`
  - `open -a Ollama`
- The `ollama` CLI now resolves to the cask-provided binary at `/opt/homebrew/bin/ollama`.

### Model

- Pulled development model: `qwen2.5:7b-instruct`.
- `ollama list` shows `qwen2.5:7b-instruct`, size 4.7 GB, quantization `Q4_K_M`.
- Exhibition model target remains `qwen3:14b` on a stronger machine.

### Verified

- `ollama --version` reports `0.30.6`.
- `curl http://localhost:11434/api/tags` lists `qwen2.5:7b-instruct`.
- `.venv/bin/python -m compileall src` passed.
- `.venv/bin/acc-gesture compose --help` shows `--llm-model`, `--ollama-url`, and `--no-llm`.
- Project Ollama client returned `status=ok` for `raw_jamo=ㄱㅏㅇ`, `composed_text=강`.
- Automated finalize JSONL integration wrote `data/compose_llm_integration.jsonl` with:
  - `action=finalize`
  - `raw_jamo=ㄱㅏㅇ`
  - `composed_text=강`
  - `llm.status=ok`
  - `llm.model=qwen2.5:7b-instruct`
  - `llm.corrected_text=강`
- First real model request took about 9 seconds including model load; a later finalize request took about 3 seconds.

### Not yet manually verified

- The OpenCV compose window Tab key path and overlay display were not manually exercised in this unattended run.
- Next manual check: run the compose window, press Enter for a few jamo, press Tab, confirm the overlay shows corrected text, then press Space.

### Command

```sh
open -a Ollama
ollama pull qwen2.5:7b-instruct
.venv/bin/acc-gesture compose --camera 0 --references data/reference_samples.jsonl --output data/compose_session.jsonl --llm-model qwen2.5:7b-instruct
```

## 2026-06-06 Seoul - local LLM finalize for compose

### What changed

- Added an Ollama-based local word correction client using only Python standard library HTTP calls.
- Added compose CLI options:
  - `--llm-model`, default `qwen3:14b`
  - `--ollama-url`, default `http://localhost:11434`
  - `--no-llm`
- Added Tab finalize behavior in `acc-gesture compose`.
- `finalize` events now write an `llm` payload with:
  - `corrected_text`
  - `candidates`
  - `note`
  - `model`
  - `status`: `ok`, `unavailable`, or `error`
- If Ollama is unavailable or returns invalid JSON, the original composed text is saved as the corrected text and compose keeps running.

### Hardware and model direction

- Runtime: Ollama.
- Exhibition model target: `qwen3:14b`.
- Development/fallback model on 16GB MacBook: `qwen2.5:7b-instruct`.
- Recommended exhibition hardware: Mac mini M4 Pro with at least 48GB unified memory; 64GB preferred.

### Command

```sh
ollama pull qwen3:14b
ollama serve
.venv/bin/acc-gesture compose --camera 0 --references data/reference_samples.jsonl --output data/compose_session.jsonl --llm-model qwen3:14b
```

### Verified

- Compile check passed.
- `acc-gesture compose --help` shows the new LLM options.
- Ollama client parses valid JSON into `status=ok`.
- Invalid LLM JSON falls back with `status=error`.
- Unavailable Ollama falls back to original composed text.
- `finalize` JSONL events include the expected `llm` payload.
- A 2-second camera smoke test loaded 620 reference samples, opened camera index 0, and wrote a `stop` event.

### Next concrete task

Install Ollama/model on the target exhibition machine and manually verify Tab finalize with a real model response, then design the display/export flow for finalized corrected text.

## 2026-06-06 Seoul - compose session JSONL logging

### What changed

- Pulled `origin/main`; local branch was already up to date.
- Added `--output` to `acc-gesture compose`.
- Compose mode now writes JSONL events containing:
  - timestamp,
  - action (`append`, `backspace`, or `stop`),
  - raw jamo buffer,
  - composed Hangul text,
  - current prediction payload when available.

### Command

```sh
.venv/bin/acc-gesture compose --camera 0 --references data/reference_samples.jsonl --output data/compose_session.jsonl
```

### Verified

- Compile check passed.
- Compose event store unit-style check wrote `ㄱㅏ -> 가` correctly.
- `acc-gesture compose --help` shows the new `--output` option.
- A 2-second camera smoke test loaded 620 reference samples, opened camera index 0, and wrote a `stop` event to `data/compose_session_smoke.jsonl`.

### Next concrete task

Add a clean "submit/finalize" action for completed composed text so it can be handed to the later LLM/display pipeline without scraping the raw event log.

## 2026-06-02 Seoul - live Hangul compose mode

### What changed

- Added `acc-gesture compose` to manually build Hangul text from live jamo predictions.
- Added a simple Hangul composer for syllables such as `ㄱㅏ -> 가`, `ㄱㅏㅇ -> 강`, and `ㅎㅏㄴㄱㅡㄹ -> 한글`.
- The compose overlay shows current prediction, raw jamo buffer, and composed Hangul text.
- Controls:
  - Enter: append the current predicted jamo.
  - Backspace: delete the last appended jamo.
  - Space: stop the window.

### Command

```sh
.venv/bin/acc-gesture compose --camera 0 --references data/reference_samples.jsonl
```

### Verified

- Compile check passed.
- Unit-style compose checks passed for `가`, `강`, `한글`, and `의`.
- A 2-second camera smoke test loaded 620 reference samples and opened camera index 0.

## 2026-06-02 Seoul - Korean overlay text rendering

### What changed

- Replaced OpenCV text drawing for prediction labels with Pillow-based text rendering.
- Added `Pillow` as a direct dependency.
- Verified `ㄱ-giyeok`, `ㅋ-kieuk`, and `ㅗ-o` render correctly in `data/korean_overlay_test.jpg`.
- On this MacBook, the overlay uses `/System/Library/Fonts/AppleSDGothicNeo.ttc`.

## 2026-06-02 Seoul - fingerspelling source citation

### What changed

- Added the Korean consonant/vowel fingerspelling source link to `README.md`.
- Source: <https://blog.naver.com/minacyworld/222236459553>

## 2026-06-02 Seoul - live jamo recognition overlay

### What changed

- Added `acc-gesture recognize` for live recognition verification.
- The camera window continuously captures frames and displays the predicted jamo in the upper-left corner.
- Labels are shown with Korean plus romanization, such as `ㄱ-giyeok`, to avoid ambiguity if Korean rendering is fragile.
- The live recognition window runs until the user presses space.

### Command

```sh
.venv/bin/acc-gesture recognize --camera 0 --references data/reference_samples.jsonl
```

### Verified

- `recognize --help` works.
- The command loaded 620 reference samples and opened camera index 0.

## 2026-06-02 Seoul - MacBook full jamo reference capture

### What changed

- Added a nearest-reference recognizer that loads `data/reference_samples.jsonl`.
- Updated `acc-gesture run` to use captured references when the file exists, with placeholder fallback if it is missing or invalid.
- Updated the canonical jamo class list to the 31 target labels:
  `ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅅ ㅇ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ ㅏ ㅑ ㅓ ㅕ ㅗ ㅛ ㅜ ㅠ ㅡ ㅣ ㅐ ㅒ ㅔ ㅖ ㅚ ㅟ ㅢ`.
- Captured 20 samples for each of the 31 labels on the MacBook camera 0.

### Data captured

- File: `data/reference_samples.jsonl`
- Total samples: 620
- Labels: 31
- Samples per label: 20
- Camera: 0

### Notes

- An earlier `giyeok` ASCII-label capture was moved to local backup `data/reference_samples_giyeok_backup_20260602.jsonl` and should not be used.
- The committed reference file uses actual jamo labels, starting from `ㄱ`.
- MediaPipe reported `ㅕ` samples as `Right` while most other labels were `Left`; keep an eye on this during accuracy review.

### Next concrete task

Run live recognition against the captured reference set:

```sh
.venv/bin/acc-gesture run --camera 0 --interval 1.0 --references data/reference_samples.jsonl --output data/session.jsonl
```

Then add repeated-frame smoothing and confidence thresholds based on the observed predictions.

## 2026-06-01 Seoul - desktop labeled reference capture command

### What changed

- Added `acc-gesture capture` to save labeled hand skeleton samples as JSONL.
- Each saved sample contains timestamp, label, handedness, raw MediaPipe points, normalized points, and flattened feature vector.
- Replaced the corrupted Korean jamo class list in `recognizer.py` with stable ASCII labels such as `giyeok`, `nieun`, `a`, and `eo`.

### Why

The next recognizer step needs reference skeletons from the actual robot hand/camera setup. The Windows desktop has no camera, so this command is intended to run on the MacBook where camera index 0 has already been verified.

### Commands to run on the MacBook

```sh
.venv/bin/acc-gesture capture --label giyeok --camera 0 --samples 20 --output data/reference_samples.jsonl
.venv/bin/acc-gesture capture --label nieun --camera 0 --samples 20 --output data/reference_samples.jsonl
.venv/bin/acc-gesture capture --label digeut --camera 0 --samples 20 --output data/reference_samples.jsonl
.venv/bin/acc-gesture capture --label a --camera 0 --samples 20 --output data/reference_samples.jsonl
.venv/bin/acc-gesture capture --label eo --camera 0 --samples 20 --output data/reference_samples.jsonl
```

### Next concrete task

After at least a few labels have reference samples, add a nearest-reference or landmark-rule recognizer to replace `PlaceholderRecognizer`.

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
