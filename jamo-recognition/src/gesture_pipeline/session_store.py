from dataclasses import asdict
import json
from pathlib import Path

from gesture_pipeline.types import CaptureResult


class JsonlSessionStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, result: CaptureResult) -> None:
        payload = asdict(result)
        payload["timestamp"] = result.timestamp.isoformat()
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
