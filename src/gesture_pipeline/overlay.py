import cv2
import numpy as np

from gesture_pipeline.types import HandLandmarks


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
