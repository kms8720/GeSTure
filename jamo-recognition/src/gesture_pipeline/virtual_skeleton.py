from datetime import datetime
import json
from pathlib import Path
import time
from urllib import request

import numpy as np

from gesture_pipeline.diagnostics import CheckItem
from gesture_pipeline.skeleton import SkeletonNormalizer
from gesture_pipeline.types import HandLandmarks, NormalizedHand


DEFAULT_VIRTUAL_SKELETON_URL = "http://127.0.0.1:3001/virtual-skeleton"


def fetch_virtual_hand(url: str = DEFAULT_VIRTUAL_SKELETON_URL, timeout_sec: float = 5.0) -> HandLandmarks:
    with request.urlopen(url, timeout=timeout_sec) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return parse_virtual_hand(payload)


def parse_virtual_hand(payload: object) -> HandLandmarks:
    if not isinstance(payload, dict):
        raise ValueError("virtual skeleton payload must be an object")

    skeleton = payload.get("skeleton", payload)
    if not isinstance(skeleton, dict):
        raise ValueError("virtual skeleton payload must contain a skeleton object")

    points = skeleton.get("points")
    if not isinstance(points, list):
        raise ValueError("virtual skeleton payload must contain points")

    array = np.asarray(points, dtype=np.float32)
    if array.shape != (21, 3):
        raise ValueError(f"virtual skeleton points must have shape (21, 3), got {array.shape}")

    handedness = skeleton.get("handedness", "Unknown")
    if handedness not in ("Left", "Right", "Unknown"):
        handedness = "Unknown"
    return HandLandmarks(points=array, handedness=handedness)


def check_virtual_skeleton(url: str = DEFAULT_VIRTUAL_SKELETON_URL) -> tuple[list[CheckItem], HandLandmarks | None]:
    try:
        hand = fetch_virtual_hand(url)
    except Exception as exc:
        return [CheckItem("virtual_skeleton", False, f"{type(exc).__name__}: {exc}")], None

    normalizer = SkeletonNormalizer()
    normalized = normalizer.normalize(hand)
    items = [
        CheckItem("virtual_skeleton", True, f"{url}, landmarks={hand.points.shape[0]}, handedness={hand.handedness}"),
        CheckItem("virtual_normalized", True, f"feature_len={normalized.flat().shape[0]}"),
    ]
    return items, hand


def capture_virtual_reference_samples(
    label: str,
    url: str,
    output_path: Path,
    samples: int,
    interval_sec: float,
) -> None:
    if samples < 1:
        raise ValueError("samples must be at least 1")
    if interval_sec < 0:
        raise ValueError("interval_sec must be 0 or greater")

    normalizer = SkeletonNormalizer()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    captured = 0

    print(f"capturing {samples} virtual samples for label '{label}' from {url}")
    with output_path.open("a", encoding="utf-8") as output:
        while captured < samples:
            raw_hand = fetch_virtual_hand(url)
            normalized = normalizer.normalize(raw_hand)
            output.write(json.dumps(_sample_payload(label, raw_hand, normalized), ensure_ascii=False) + "\n")
            output.flush()
            captured += 1
            print(f"captured {captured}/{samples}: {label} ({normalized.handedness})")
            if captured < samples and interval_sec > 0:
                time.sleep(interval_sec)

    print(f"saved {captured} virtual samples to {output_path}")


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
            "source": "virtual-hand-rigged-final",
            "landmarks": 21,
            "coordinates": ["x", "y", "z"],
        },
    }
