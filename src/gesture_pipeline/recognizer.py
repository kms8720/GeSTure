from abc import ABC, abstractmethod

import numpy as np

from gesture_pipeline.types import JamoPrediction, NormalizedHand


JAMO_CLASSES = [
    "ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
    "ㅏ", "ㅑ", "ㅓ", "ㅕ", "ㅗ", "ㅛ", "ㅜ", "ㅠ", "ㅡ", "ㅣ",
    "ㅐ", "ㅒ", "ㅔ", "ㅖ", "ㅘ", "ㅝ", "ㅢ",
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
            label="?",
            confidence=score,
            candidates=[("?", score)],
        )
