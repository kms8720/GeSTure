# ACC GeSTure Algorithm

Python pipeline for the mock-up stage of the ACC GeSTure project.

The first goal is to sample the robot hand with a camera every second, extract skeletal hand landmarks, normalize them so camera placement matters less, and turn each captured pose into a jamo candidate.

## Current Pipeline

1. Capture a camera frame every 1 second.
2. Extract 21 hand landmarks using MediaPipe.
3. Normalize landmarks around the wrist and palm scale.
4. Classify the pose with captured reference skeleton samples when available.
5. Store timestamped jamo candidates as JSONL.

## Run

Use Python 3.10, 3.11, or 3.12 with `mediapipe==0.10.14`. Newer MediaPipe wheels may not expose the legacy `mp.solutions.hands` API used by this mock-up pipeline.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
acc-gesture check --camera 0 --save-frame data/check_frame.jpg
acc-gesture check --scan-cameras --max-camera-index 3
acc-gesture preview --camera 0
acc-gesture capture --label ㄱ --camera 0 --samples 20 --output data/reference_samples.jsonl
acc-gesture recognize --camera 0 --references data/reference_samples.jsonl
acc-gesture compose --camera 0 --references data/reference_samples.jsonl --output data/compose_session.jsonl --llm-model qwen3:14b
acc-gesture run --camera 0 --interval 1.0 --output data/session.jsonl
```

Press `q` in the camera preview window to stop.

`acc-gesture check --no-camera` only checks the Python environment and installed packages.

Use `acc-gesture preview --camera 0` on a camera-equipped laptop to visually inspect whether the hand skeleton points and lines are tracking correctly.

Use `acc-gesture capture --label ㄱ --camera 0 --samples 20` to save labeled skeleton references. The current reference set covers `ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅅ ㅇ ㅈ ㅊ ㅋ ㅌ ㅍ ㅎ ㅏ ㅑ ㅓ ㅕ ㅗ ㅛ ㅜ ㅠ ㅡ ㅣ ㅐ ㅒ ㅔ ㅖ ㅚ ㅟ ㅢ`.

When `data/reference_samples.jsonl` exists, `acc-gesture run` uses a nearest-reference recognizer. If the file is missing, it falls back to the placeholder recognizer.

Use `acc-gesture recognize --camera 0 --references data/reference_samples.jsonl` to check jamo recognition live. The camera window shows labels such as `ㄱ-giyeok` in the upper-left corner. Press space in the window to stop. Korean overlay text is rendered with Pillow and a Korean-capable system font, such as Apple SD Gothic Neo on macOS.

Use `acc-gesture compose --camera 0 --references data/reference_samples.jsonl --output data/compose_session.jsonl --llm-model qwen3:14b` to build Hangul text manually from live jamo predictions. Press Enter to append the current predicted jamo, Backspace to delete the last jamo, Tab to finalize and run local LLM word correction, and Space to stop. The overlay shows both raw jamo and composed Hangul text, such as `ㄱㅏㅇ` -> `강`. Compose events are saved as JSONL with the action, raw jamo buffer, composed text, current prediction, and LLM correction payload when finalized.

For local LLM correction, install and run Ollama. On macOS, prefer the Ollama app cask so the bundled runtime server is available:

```sh
brew install --cask ollama-app
open -a Ollama
ollama pull qwen3:14b
```

On the current MacBook M1 Pro 16GB development machine, use the smaller fallback model:

```sh
ollama pull qwen2.5:7b-instruct
acc-gesture compose --camera 0 --references data/reference_samples.jsonl --output data/compose_session.jsonl --llm-model qwen2.5:7b-instruct
```

If Ollama is unavailable or returns invalid JSON, compose mode keeps running and saves the original composed text as the corrected text. Use `--no-llm` to disable LLM correction during testing. For the long-running exhibition machine, a Mac mini M4 Pro with at least 48GB unified memory is recommended; 64GB is preferred. The current MacBook M1 Pro 16GB is suitable for development and can use a smaller fallback model such as `qwen2.5:7b-instruct`.

## Korean Fingerspelling Reference

The Korean consonant/vowel fingerspelling poses used for the current jamo reference set are based on this Naver Blog reference page: <https://blog.naver.com/minacyworld/222236459553>.

## Next Implementation Steps

1. Review recognition accuracy with the captured reference set.
2. Add per-letter confidence thresholds and repeated-frame smoothing.
3. Review finalized LLM correction logs from `data/compose_session.jsonl`.
4. Add display/export handling for finalized corrected text.
5. Render generated text/image states for exhibition display.
