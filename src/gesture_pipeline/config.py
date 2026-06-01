from pathlib import Path

from pydantic import BaseModel, Field


class PipelineConfig(BaseModel):
    camera_index: int = 0
    sample_interval_sec: float = Field(default=1.0, gt=0)
    output_path: Path = Path("data/session.jsonl")
    show_preview: bool = True
    max_hands: int = 1
    min_detection_confidence: float = Field(default=0.5, ge=0, le=1)
    min_tracking_confidence: float = Field(default=0.5, ge=0, le=1)
