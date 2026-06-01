import cv2
import numpy as np

from gesture_pipeline.types import HandLandmarks
from gesture_pipeline.recognizer import format_jamo_label
from gesture_pipeline.types import JamoPrediction


HAND_CONNECTIONS = (
    (0, 1),
    (1, 2),
    (2, 3),
    (3, 4),
    (0, 5),
    (5, 6),
    (6, 7),
    (7, 8),
    (5, 9),
    (9, 10),
    (10, 11),
    (11, 12),
    (9, 13),
    (13, 14),
    (14, 15),
    (15, 16),
    (13, 17),
    (0, 17),
    (17, 18),
    (18, 19),
    (19, 20),
)


def draw_hand_overlay(image_bgr: np.ndarray, landmarks: HandLandmarks | None) -> np.ndarray:
    image = image_bgr.copy()
    if landmarks is None:
        cv2.putText(
            image,
            "no hand detected",
            (20, 36),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (0, 0, 255),
            2,
            cv2.LINE_AA,
        )
        return image

    height, width = image.shape[:2]
    points = [
        (int(np.clip(point[0], 0.0, 1.0) * width), int(np.clip(point[1], 0.0, 1.0) * height))
        for point in landmarks.points
    ]

    for start, end in HAND_CONNECTIONS:
        cv2.line(image, points[start], points[end], (0, 255, 180), 3, cv2.LINE_AA)
    for index, point in enumerate(points):
        radius = 6 if index in (0, 4, 8, 12, 16, 20) else 4
        cv2.circle(image, point, radius, (255, 80, 0), -1, cv2.LINE_AA)

    cv2.putText(
        image,
        f"hand: {landmarks.handedness}",
        (20, 36),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.9,
        (0, 255, 180),
        2,
        cv2.LINE_AA,
    )
    return image


def draw_prediction_overlay(image_bgr: np.ndarray, prediction: JamoPrediction | None) -> np.ndarray:
    image = image_bgr.copy()
    if prediction is None:
        _draw_text_panel(image, ["label: no hand detected"], (20, 36), color=(0, 0, 255))
        return image

    lines = [
        f"label: {format_jamo_label(prediction.label)}",
        f"confidence: {prediction.confidence:.2f}",
    ]
    if prediction.candidates:
        candidates = ", ".join(f"{format_jamo_label(label)} {score:.2f}" for label, score in prediction.candidates[:3])
        lines.append(f"top: {candidates}")
    _draw_text_panel(image, lines, (20, 36), color=(0, 255, 180))
    return image


def _draw_text_panel(
    image: np.ndarray,
    lines: list[str],
    origin: tuple[int, int],
    color: tuple[int, int, int],
) -> None:
    x, y = origin
    line_height = 34
    max_width = 0
    for line in lines:
        (width, _), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 2)
        max_width = max(max_width, width)

    panel_top = max(0, y - 28)
    panel_bottom = y + line_height * len(lines)
    overlay = image.copy()
    cv2.rectangle(overlay, (x - 10, panel_top), (x + max_width + 12, panel_bottom), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, image, 0.45, 0, image)

    for index, line in enumerate(lines):
        cv2.putText(
            image,
            line,
            (x, y + line_height * index),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            color,
            2,
            cv2.LINE_AA,
        )
