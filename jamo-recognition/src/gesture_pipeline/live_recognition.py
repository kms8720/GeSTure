import time

import cv2

from gesture_pipeline.camera import open_camera_capture
from gesture_pipeline.overlay import draw_hand_overlay, draw_prediction_overlay
from gesture_pipeline.recognizer import JamoRecognizer
from gesture_pipeline.skeleton import MediaPipeHandExtractor, SkeletonNormalizer


def recognize_live(camera_index: int, recognizer: JamoRecognizer, duration_sec: float = 0.0) -> None:
    cap, backend = open_camera_capture(camera_index)
    extractor = MediaPipeHandExtractor(max_hands=1)
    normalizer = SkeletonNormalizer()
    deadline = time.monotonic() + duration_sec if duration_sec > 0 else None

    print(f"camera index {camera_index} opened with {backend}")
    print("press space in the recognition window to stop")

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
            preview = draw_prediction_overlay(preview, prediction)
            cv2.imshow("ACC GeSTure live recognition", preview)
            key = cv2.waitKey(1) & 0xFF
            if key == ord(" "):
                break
    finally:
        extractor.close()
        cap.release()
        cv2.destroyWindow("ACC GeSTure live recognition")
