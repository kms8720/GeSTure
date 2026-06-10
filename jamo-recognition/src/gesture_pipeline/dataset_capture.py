from datetime import datetime
import json
from pathlib import Path
import time

import cv2

from gesture_pipeline.camera import open_camera_capture
from gesture_pipeline.overlay import draw_hand_overlay
from gesture_pipeline.skeleton import MediaPipeHandExtractor, SkeletonNormalizer
from gesture_pipeline.types import HandLandmarks, NormalizedHand


def capture_reference_samples(
    label: str,
    camera_index: int,
    output_path: Path,
    samples: int,
    interval_sec: float,
    show_preview: bool,
) -> None:
    if samples < 1:
        raise ValueError("samples must be at least 1")
    if interval_sec < 0:
        raise ValueError("interval_sec must be 0 or greater")

    cap, backend = open_camera_capture(camera_index)
    extractor = MediaPipeHandExtractor(max_hands=1)
    normalizer = SkeletonNormalizer()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    captured = 0
    next_capture = time.monotonic()
    print(f"camera index {camera_index} opened with {backend}")
    print(f"capturing {samples} samples for label '{label}'")
    if show_preview:
        print("press q in the preview window to stop early")

    try:
        with output_path.open("a", encoding="utf-8") as output:
            while captured < samples:
                ok, frame = cap.read()
                if not ok:
                    raise RuntimeError("Failed to read camera frame")

                raw_hand = extractor.extract(frame)
                now = time.monotonic()
                if raw_hand is not None and now >= next_capture:
                    next_capture = now + interval_sec
                    normalized = normalizer.normalize(raw_hand)
                    output.write(json.dumps(_sample_payload(label, raw_hand, normalized), ensure_ascii=False) + "\n")
                    output.flush()
                    captured += 1
                    print(f"captured {captured}/{samples}: {label} ({normalized.handedness})")

                if show_preview:
                    preview = draw_hand_overlay(frame, raw_hand)
                    cv2.putText(
                        preview,
                        f"label: {label}  samples: {captured}/{samples}",
                        (20, 72),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.8,
                        (255, 255, 255),
                        2,
                        cv2.LINE_AA,
                    )
                    cv2.imshow("ACC GeSTure reference capture", preview)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
    finally:
        extractor.close()
        cap.release()
        if show_preview:
            cv2.destroyWindow("ACC GeSTure reference capture")

    print(f"saved {captured} samples to {output_path}")


def _sample_payload(label: str, raw_hand: HandLandmarks, normalized: NormalizedHand) -> dict:
    return {
        "timestamp": datetime.now().isoformat(),
        "label": label,
        "handedness": normalized.handedness,
        "raw_points": raw_hand.points.tolist(),
        "normalized_points": normalized.points.tolist(),
        "feature": normalized.flat().tolist(),
        "metadata": {
            "format": "acc-gesture-reference-v1",
            "landmarks": 21,
            "coordinates": ["x", "y", "z"],
        },
    }
