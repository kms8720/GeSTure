from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
import time

import cv2
import numpy as np


CAMERA_BACKENDS = (
    ("auto", cv2.CAP_ANY),
    ("dshow", cv2.CAP_DSHOW),
    ("msmf", cv2.CAP_MSMF),
)


@dataclass(frozen=True)
class CameraFrame:
    image_bgr: np.ndarray
    timestamp: datetime


def open_camera_capture(camera_index: int) -> tuple[cv2.VideoCapture, str]:
    attempts: list[str] = []
    for name, backend in CAMERA_BACKENDS:
        cap = cv2.VideoCapture(camera_index, backend)
        if cap.isOpened():
            return cap, name
        cap.release()
        attempts.append(name)
    tried = ", ".join(attempts)
    raise RuntimeError(f"Could not open camera index {camera_index} with backends: {tried}")


class CameraSampler:
    def __init__(self, camera_index: int, interval_sec: float) -> None:
        self.camera_index = camera_index
        self.interval_sec = interval_sec

    def frames(self) -> Iterator[CameraFrame]:
        cap, backend = open_camera_capture(self.camera_index)
        print(f"camera index {self.camera_index} opened with {backend}")

        try:
            next_capture = 0.0
            while True:
                ok, frame = cap.read()
                if not ok:
                    raise RuntimeError("Failed to read camera frame")

                now = time.monotonic()
                if now >= next_capture:
                    next_capture = now + self.interval_sec
                    yield CameraFrame(image_bgr=frame, timestamp=datetime.now())
                else:
                    time.sleep(min(0.01, max(0.0, next_capture - now)))
        finally:
            cap.release()
