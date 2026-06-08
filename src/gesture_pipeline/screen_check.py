from dataclasses import dataclass
from pathlib import Path

import cv2

from gesture_pipeline.diagnostics import CheckItem
from gesture_pipeline.overlay import draw_hand_overlay
from gesture_pipeline.skeleton import MediaPipeHandExtractor, SkeletonNormalizer


@dataclass(frozen=True)
class ScreenCheckResult:
    items: list[CheckItem]
    detected: bool


def check_screen_image(
    image_path: Path,
    save_overlay: Path | None = None,
    min_detection_confidence: float = 0.5,
) -> ScreenCheckResult:
    items: list[CheckItem] = []
    image = cv2.imread(str(image_path))
    if image is None:
        return ScreenCheckResult(
            items=[CheckItem("screen_image", False, f"could not read {image_path}")],
            detected=False,
        )

    height, width = image.shape[:2]
    items.append(CheckItem("screen_image", True, f"{image_path}, frame {width}x{height}"))

    extractor = MediaPipeHandExtractor(
        max_hands=1,
        static_image_mode=True,
        min_detection_confidence=min_detection_confidence,
    )
    try:
        raw_hand = extractor.extract(image)
    finally:
        extractor.close()

    if save_overlay is not None:
        save_overlay.parent.mkdir(parents=True, exist_ok=True)
        saved = cv2.imwrite(str(save_overlay), draw_hand_overlay(image, raw_hand))
        items.append(CheckItem("save_overlay", saved, str(save_overlay)))

    if raw_hand is None:
        items.append(CheckItem("hand_skeleton", False, "no hand detected in screen capture"))
        return ScreenCheckResult(items=items, detected=False)

    normalized = SkeletonNormalizer().normalize(raw_hand)
    items.append(
        CheckItem(
            "hand_skeleton",
            True,
            f"{normalized.handedness}, landmarks={normalized.points.shape[0]}",
        )
    )
    return ScreenCheckResult(items=items, detected=True)
