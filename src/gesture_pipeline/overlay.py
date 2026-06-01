import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

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

FONT_CANDIDATES = (
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
    "/Library/Fonts/AppleGothic.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    "C:/Windows/Fonts/malgun.ttf",
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
    font = _load_text_font(28)
    line_height = 38
    padding_x = 12
    padding_y = 10
    max_width = 1
    for line in lines:
        bbox = font.getbbox(line)
        max_width = max(max_width, bbox[2] - bbox[0])

    panel_left = max(0, x - padding_x)
    panel_top = max(0, y - 30)
    panel_right = x + max_width + padding_x
    panel_bottom = y + line_height * len(lines) - 2 + padding_y
    overlay = image.copy()
    cv2.rectangle(overlay, (panel_left, panel_top), (panel_right, panel_bottom), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, image, 0.45, 0, image)

    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(rgb)
    draw = ImageDraw.Draw(pil_image)
    fill = (color[2], color[1], color[0])
    for index, line in enumerate(lines):
        draw.text((x, y - 26 + line_height * index), line, font=font, fill=fill)
    image[:, :] = cv2.cvtColor(np.asarray(pil_image), cv2.COLOR_RGB2BGR)


def _load_text_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()
