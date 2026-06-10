from abc import ABC, abstractmethod
from dataclasses import dataclass
import json
from pathlib import Path

import numpy as np

from gesture_pipeline.types import JamoPrediction, NormalizedHand


JAMO_CLASSES = [
    "ㄱ",
    "ㄴ",
    "ㄷ",
    "ㄹ",
    "ㅁ",
    "ㅂ",
    "ㅅ",
    "ㅇ",
    "ㅈ",
    "ㅊ",
    "ㅋ",
    "ㅌ",
    "ㅍ",
    "ㅎ",
    "ㅏ",
    "ㅑ",
    "ㅓ",
    "ㅕ",
    "ㅗ",
    "ㅛ",
    "ㅜ",
    "ㅠ",
    "ㅡ",
    "ㅣ",
    "ㅐ",
    "ㅒ",
    "ㅔ",
    "ㅖ",
    "ㅚ",
    "ㅟ",
    "ㅢ",
]

JAMO_ROMANIZATION = {
    "ㄱ": "giyeok",
    "ㄴ": "nieun",
    "ㄷ": "digeut",
    "ㄹ": "rieul",
    "ㅁ": "mieum",
    "ㅂ": "bieup",
    "ㅅ": "siot",
    "ㅇ": "ieung",
    "ㅈ": "jieut",
    "ㅊ": "chieut",
    "ㅋ": "kieuk",
    "ㅌ": "tieut",
    "ㅍ": "pieup",
    "ㅎ": "hieut",
    "ㅏ": "a",
    "ㅑ": "ya",
    "ㅓ": "eo",
    "ㅕ": "yeo",
    "ㅗ": "o",
    "ㅛ": "yo",
    "ㅜ": "u",
    "ㅠ": "yu",
    "ㅡ": "eu",
    "ㅣ": "i",
    "ㅐ": "ae",
    "ㅒ": "yae",
    "ㅔ": "e",
    "ㅖ": "ye",
    "ㅚ": "oe",
    "ㅟ": "wi",
    "ㅢ": "ui",
}


def format_jamo_label(label: str) -> str:
    romanized = JAMO_ROMANIZATION.get(label)
    if romanized is None:
        return label
    return f"{label}-{romanized}"


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


@dataclass(frozen=True)
class ReferenceSample:
    label: str
    feature: np.ndarray


class ReferenceRecognizer(JamoRecognizer):
    """Nearest-reference recognizer backed by captured skeleton samples."""

    def __init__(self, samples: list[ReferenceSample], neighbors: int = 3) -> None:
        if not samples:
            raise ValueError("ReferenceRecognizer requires at least one sample")
        if neighbors < 1:
            raise ValueError("neighbors must be at least 1")

        self.samples = samples
        self.neighbors = neighbors
        self.labels = sorted({sample.label for sample in samples})

    @classmethod
    def from_jsonl(cls, path: Path, neighbors: int = 3) -> "ReferenceRecognizer":
        samples: list[ReferenceSample] = []
        with path.open("r", encoding="utf-8") as input_file:
            for line_number, line in enumerate(input_file, start=1):
                if not line.strip():
                    continue
                payload = json.loads(line)
                label = payload.get("label")
                feature = payload.get("feature")
                if not isinstance(label, str) or not isinstance(feature, list):
                    raise ValueError(f"Invalid reference sample at {path}:{line_number}")
                vector = np.asarray(feature, dtype=np.float32)
                if vector.shape != (63,):
                    raise ValueError(f"Invalid feature shape at {path}:{line_number}: {vector.shape}")
                samples.append(ReferenceSample(label=label, feature=vector))
        return cls(samples=samples, neighbors=neighbors)

    def predict(self, hand: NormalizedHand) -> JamoPrediction:
        feature = hand.flat().astype(np.float32)
        ranked: list[tuple[str, float]] = []

        for label in self.labels:
            distances = sorted(
                float(np.linalg.norm(feature - sample.feature))
                for sample in self.samples
                if sample.label == label
            )
            label_distance = float(np.mean(distances[: self.neighbors]))
            ranked.append((label, label_distance))

        ranked.sort(key=lambda item: item[1])
        best_label, best_distance = ranked[0]
        confidence = self._confidence(ranked)
        candidates = [(label, self._distance_score(distance)) for label, distance in ranked[:5]]
        return JamoPrediction(label=best_label, confidence=confidence, candidates=candidates)

    @staticmethod
    def _distance_score(distance: float) -> float:
        return float(np.clip(1.0 / (1.0 + distance), 0.0, 1.0))

    def _confidence(self, ranked: list[tuple[str, float]]) -> float:
        best_distance = ranked[0][1]
        if len(ranked) == 1:
            return self._distance_score(best_distance)

        next_distance = ranked[1][1]
        margin = max(0.0, next_distance - best_distance)
        margin_score = margin / (next_distance + 1e-6)
        distance_score = self._distance_score(best_distance)
        return float(np.clip(0.35 * distance_score + 0.65 * margin_score, 0.0, 1.0))
