from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import numpy as np


Handedness = Literal["Left", "Right", "Unknown"]


@dataclass(frozen=True)
class HandLandmarks:
    points: np.ndarray
    handedness: Handedness = "Unknown"

    def __post_init__(self) -> None:
        if self.points.shape != (21, 3):
            raise ValueError("HandLandmarks.points must have shape (21, 3)")


@dataclass(frozen=True)
class NormalizedHand:
    points: np.ndarray
    handedness: Handedness

    def flat(self) -> np.ndarray:
        return self.points.reshape(-1)


@dataclass(frozen=True)
class JamoPrediction:
    label: str
    confidence: float
    candidates: list[tuple[str, float]]


@dataclass(frozen=True)
class CaptureResult:
    timestamp: datetime
    prediction: JamoPrediction | None
    handedness: Handedness
    detected: bool
