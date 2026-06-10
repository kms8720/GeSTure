import cv2

from gesture_pipeline.camera import CameraSampler
from gesture_pipeline.config import PipelineConfig
from gesture_pipeline.overlay import draw_hand_overlay
from gesture_pipeline.recognizer import JamoRecognizer
from gesture_pipeline.session_store import JsonlSessionStore
from gesture_pipeline.skeleton import MediaPipeHandExtractor, SkeletonNormalizer
from gesture_pipeline.types import CaptureResult, HandLandmarks


class GesturePipeline:
    def __init__(self, config: PipelineConfig, recognizer: JamoRecognizer) -> None:
        self.config = config
        self.recognizer = recognizer
        self.sampler = CameraSampler(config.camera_index, config.sample_interval_sec)
        self.extractor = MediaPipeHandExtractor(
            max_hands=config.max_hands,
            min_detection_confidence=config.min_detection_confidence,
            min_tracking_confidence=config.min_tracking_confidence,
        )
        self.normalizer = SkeletonNormalizer()
        self.store = JsonlSessionStore(config.output_path)

    def run(self) -> None:
        try:
            for frame in self.sampler.frames():
                result, raw_hand = self._process_frame(frame)
                self.store.append(result)
                self._print_result(result)

                if self.config.show_preview:
                    cv2.imshow("ACC GeSTure camera", draw_hand_overlay(frame.image_bgr, raw_hand))
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
        finally:
            self.extractor.close()
            if self.config.show_preview:
                cv2.destroyAllWindows()

    def _process_frame(self, frame) -> tuple[CaptureResult, HandLandmarks | None]:
        raw_hand = self.extractor.extract(frame.image_bgr)
        if raw_hand is None:
            result = CaptureResult(
                timestamp=frame.timestamp,
                prediction=None,
                handedness="Unknown",
                detected=False,
            )
            return result, None

        normalized = self.normalizer.normalize(raw_hand)
        prediction = self.recognizer.predict(normalized)
        result = CaptureResult(
            timestamp=frame.timestamp,
            prediction=prediction,
            handedness=normalized.handedness,
            detected=True,
        )
        return result, raw_hand

    @staticmethod
    def _print_result(result: CaptureResult) -> None:
        if not result.detected or result.prediction is None:
            print(f"{result.timestamp.isoformat()} no hand detected")
            return
        print(
            f"{result.timestamp.isoformat()} "
            f"hand={result.handedness} "
            f"jamo={result.prediction.label} "
            f"confidence={result.prediction.confidence:.2f}"
        )
