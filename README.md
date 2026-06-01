# ACC GeSTure Algorithm

Python pipeline for the mock-up stage of the ACC GeSTure project.

The first goal is to sample the robot hand with a camera every second, extract skeletal hand landmarks, normalize them so camera placement matters less, and turn each captured pose into a jamo candidate.

## Current Pipeline

1. Capture a camera frame every 1 second.
2. Extract 21 hand landmarks using MediaPipe.
3. Normalize landmarks around the wrist and palm scale.
4. Classify the pose with a placeholder recognizer.
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
acc-gesture run --camera 0 --interval 1.0 --output data/session.jsonl
```

Press `q` in the camera preview window to stop.

`acc-gesture check --no-camera` only checks the Python environment and installed packages.

Use `acc-gesture preview --camera 0` on a camera-equipped laptop to visually inspect whether the hand skeleton points and lines are tracking correctly.

## Next Implementation Steps

1. Replace the placeholder recognizer with real jamo rules or a trained model.
2. Add per-letter confidence thresholds and repeated-frame smoothing.
3. Add jamo composition into syllables and words.
4. Connect recognized text to LLM interpretation.
5. Render generated text/image states for exhibition display.
