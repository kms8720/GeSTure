from dataclasses import asdict
from datetime import datetime
import json
from pathlib import Path
import time

import cv2

from gesture_pipeline.camera import open_camera_capture
from gesture_pipeline.hangul import HangulComposer
from gesture_pipeline.llm import WordCorrectionResult
from gesture_pipeline.overlay import draw_compose_overlay, draw_hand_overlay
from gesture_pipeline.recognizer import JamoRecognizer
from gesture_pipeline.skeleton import MediaPipeHandExtractor, SkeletonNormalizer
from gesture_pipeline.types import JamoPrediction


def compose_live(
    camera_index: int,
    recognizer: JamoRecognizer,
    duration_sec: float = 0.0,
    output_path: Path | None = None,
    word_corrector: object | None = None,
) -> None:
    cap, backend = open_camera_capture(camera_index)
    extractor = MediaPipeHandExtractor(max_hands=1)
    normalizer = SkeletonNormalizer()
    composer = HangulComposer()
    deadline = time.monotonic() + duration_sec if duration_sec > 0 else None
    event_store = ComposeEventStore(output_path) if output_path is not None else None
    last_correction: WordCorrectionResult | None = None

    print(f"camera index {camera_index} opened with {backend}")
    print("Enter commits the current jamo, Backspace deletes, Tab finalizes, Space stops")
    if output_path is not None:
        print(f"compose events will be saved to {output_path}")

    try:
        while deadline is None or time.monotonic() < deadline:
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError("Failed to read camera frame")

            raw_hand = extractor.extract(frame)
            prediction = None
            if raw_hand is not None:
                normalized = normalizer.normalize(raw_hand)
                prediction = recognizer.predict(normalized)

            preview = draw_hand_overlay(frame, raw_hand)
            preview = draw_compose_overlay(preview, prediction, composer.raw, composer.text, last_correction)
            cv2.imshow("ACC GeSTure live compose", preview)
            key = cv2.waitKey(1) & 0xFF
            if key == ord(" "):
                break
            if key in (10, 13) and prediction is not None:
                composer.append(prediction.label)
                print(f"jamo={composer.raw} text={composer.text}")
                if event_store is not None:
                    event_store.append("append", composer, prediction)
            elif key in (8, 127):
                composer.backspace()
                print(f"jamo={composer.raw} text={composer.text}")
                if event_store is not None:
                    event_store.append("backspace", composer, prediction)
            elif key == 9:
                if word_corrector is None:
                    last_correction = WordCorrectionResult(
                        corrected_text=composer.text,
                        candidates=[composer.text] if composer.text else [],
                        note="LLM disabled",
                        model="disabled",
                        status="unavailable",
                    )
                else:
                    last_correction = word_corrector.correct(composer.raw, composer.text)
                print(
                    f"finalize raw_jamo={composer.raw} "
                    f"text={composer.text} "
                    f"corrected={last_correction.corrected_text} "
                    f"llm_status={last_correction.status}"
                )
                if event_store is not None:
                    event_store.append("finalize", composer, prediction, last_correction)
    finally:
        if event_store is not None:
            event_store.append("stop", composer, None)
        extractor.close()
        cap.release()
        cv2.destroyWindow("ACC GeSTure live compose")


class ComposeEventStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(
        self,
        action: str,
        composer: HangulComposer,
        prediction: JamoPrediction | None,
        correction: WordCorrectionResult | None = None,
    ) -> None:
        payload = {
            "timestamp": datetime.now().isoformat(),
            "action": action,
            "raw_jamo": composer.raw,
            "composed_text": composer.text,
            "prediction": _prediction_payload(prediction),
            "llm": correction.to_dict() if correction is not None else None,
        }
        with self.path.open("a", encoding="utf-8") as output:
            output.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _prediction_payload(prediction: JamoPrediction | None) -> dict | None:
    if prediction is None:
        return None
    return asdict(prediction)
