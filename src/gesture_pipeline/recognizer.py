from abc import ABC, abstractmethod

import numpy as np

from gesture_pipeline.types import JamoPrediction, NormalizedHand


JAMO_CLASSES = [
    "giyeok",
    "nieun",
    "digeut",
    "rieul",
    "mieum",
    "bieup",
    "siot",
    "ieung",
    "jieut",
    "chieut",
    "kieuk",
    "tieut",
    "pieup",
    "hieut",
    "a",
    "ya",
    "eo",
    "yeo",
    "o",
    "yo",
    "u",
    "yu",
    "eu",
    "i",
]


class JamoRecognizer(ABC):
    @abstractmethod
    def predict(self, hand: NormalizedHand) -> JamoPrediction:
        raise NotImplementedError


class PlaceholderRecognizer(JamoRecognizer):
    """Temporary recognizer until real jamo rules or a trained model are added."""

    def predict(self, hand: NormalizedHand) -> JamoPrediction:
        feature = hand.flat()
        score = float(np.clip(np.linalg.norm(feature) / 20.0, 0.05, 0.95))
        return JamoPrediction(
            label="unknown",
            confidence=score,
            candidates=[("unknown", score)],
        )
