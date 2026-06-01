import time

import cv2

from gesture_pipeline.camera import open_camera_capture
from gesture_pipeline.hangul import HangulComposer
from gesture_pipeline.overlay import draw_compose_overlay, draw_hand_overlay
from gesture_pipeline.recognizer import JamoRecognizer
from gesture_pipeline.skeleton import MediaPipeHandExtractor, SkeletonNormalizer


def compose_live(camera_index: int, recognizer: JamoRecognizer, duration_sec: float = 0.0) -> None:
    cap, backend = open_camera_capture(camera_index)
    extractor = MediaPipeHandExtractor(max_hands=1)
    normalizer = SkeletonNormalizer()
    composer = HangulComposer()
    deadline = time.monotonic() + duration_sec if duration_sec > 0 else None

    print(f"camera index {camera_index} opened with {backend}")
    print("Enter commits the current jamo, Backspace deletes, Space stops")

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
            preview = draw_compose_overlay(preview, prediction, composer.raw, composer.text)
            cv2.imshow("ACC GeSTure live compose", preview)
            key = cv2.waitKey(1) & 0xFF
            if key == ord(" "):
                break
            if key in (10, 13) and prediction is not None:
                composer.append(prediction.label)
                print(f"jamo={composer.raw} text={composer.text}")
            elif key in (8, 127):
                composer.backspace()
                print(f"jamo={composer.raw} text={composer.text}")
    finally:
        extractor.close()
        cap.release()
        cv2.destroyWindow("ACC GeSTure live compose")
