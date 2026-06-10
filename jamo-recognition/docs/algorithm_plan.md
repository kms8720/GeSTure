# Algorithm Plan

## Why Skeletal Landmarks

For the exhibition, the camera may be mounted from the front, side, above, or at a slight angle. Raw image classification would be sensitive to lighting, scale, background, and camera position. A skeletal approach is a better first architecture because the algorithm operates on 21 hand joint points instead of raw pixels.

The current normalizer already removes:

- hand position by moving the wrist to the origin
- hand size by scaling with the wrist-to-middle-MCP distance
- in-plane camera rotation by aligning the palm direction

Later, if the camera angle changes too much, we can add stronger 3D normalization:

- palm-plane alignment using wrist, index MCP, and pinky MCP
- mirror correction for left/right hands
- temporal smoothing across nearby frames
- calibration pose at exhibition startup

## Implementation Order

### 1. Camera and Sampling

Status: scaffolded

Capture one frame every second and pass it into the recognition pipeline.

### 2. Skeletal Extraction

Status: scaffolded

Use MediaPipe Hands to extract 21 landmarks from the robot hand image. If MediaPipe struggles with the robot hand material, add:

- higher contrast hand covering
- colored fingertip markers
- custom marker tracking fallback

### 3. Pose Normalization

Status: scaffolded

Normalize pose coordinates so the classifier sees hand shape rather than camera placement.

### 4. Jamo Recognition

Status: placeholder

Replace `PlaceholderRecognizer` with one of these:

- rule-based geometric recognizer for the first demo
- trained MLP over 63D landmarks
- hybrid recognizer with geometric overrides for confusing jamo pairs

### 5. Sequence Buffer

Status: not implemented

Collect one jamo candidate per second. Add duplicate filtering and confidence thresholds so one held pose does not flood the output.

### 6. Jamo Composition

Status: not implemented

Combine consonants and vowels into Korean syllables or store them as an exhibition dictionary.

### 7. LLM Interpretation

Status: not implemented

Send the recognized jamo or words to an LLM to generate a sentence, poetic interpretation, or exhibition message.

### 8. Exhibition Output

Status: not implemented

Render text, floating jamo, generated images, and evolving background states on a screen or projector.
