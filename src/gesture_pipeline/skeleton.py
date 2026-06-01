import cv2
import mediapipe as mp
import numpy as np

from gesture_pipeline.types import HandLandmarks, NormalizedHand


class MediaPipeHandExtractor:
    def __init__(
        self,
        max_hands: int = 1,
        min_detection_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
    ) -> None:
        if not hasattr(mp, "solutions"):
            raise RuntimeError(
                "MediaPipe legacy Hands API is unavailable. "
                "Use Python 3.10-3.12 with a compatible mediapipe wheel, "
                "or migrate this extractor to mediapipe.tasks."
            )
        self._hands = mp.solutions.hands.Hands(
            static_image_mode=False,
            max_num_hands=max_hands,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )

    def extract(self, image_bgr: np.ndarray) -> HandLandmarks | None:
        image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        result = self._hands.process(image_rgb)
        if not result.multi_hand_landmarks:
            return None

        idx = self._select_hand_index(result)
        landmarks = result.multi_hand_landmarks[idx].landmark
        points = np.array([[lm.x, lm.y, lm.z] for lm in landmarks], dtype=np.float32)
        handedness = "Unknown"
        if result.multi_handedness and idx < len(result.multi_handedness):
            handedness = result.multi_handedness[idx].classification[0].label
        return HandLandmarks(points=points, handedness=handedness)

    def close(self) -> None:
        self._hands.close()

    @staticmethod
    def _select_hand_index(result: object) -> int:
        if not getattr(result, "multi_handedness", None):
            return 0
        for i, handedness in enumerate(result.multi_handedness):
            if handedness.classification[0].label == "Right":
                return i
        return 0


class SkeletonNormalizer:
    WRIST = 0
    MIDDLE_MCP = 9

    def normalize(self, landmarks: HandLandmarks) -> NormalizedHand:
        points = landmarks.points.astype(np.float32).copy()
        origin = points[self.WRIST].copy()
        points -= origin

        scale = np.linalg.norm(points[self.MIDDLE_MCP])
        if scale < 1e-6:
            scale = 1.0
        points /= scale

        points = self._align_palm(points)
        return NormalizedHand(points=points, handedness=landmarks.handedness)

    def _align_palm(self, points: np.ndarray) -> np.ndarray:
        # Rotate in the image plane so wrist -> middle MCP points upward.
        palm = points[self.MIDDLE_MCP, :2]
        angle = np.arctan2(palm[1], palm[0])
        target = -np.pi / 2
        theta = target - angle
        cos_t = np.cos(theta)
        sin_t = np.sin(theta)
        rot = np.array([[cos_t, -sin_t], [sin_t, cos_t]], dtype=np.float32)
        aligned = points.copy()
        aligned[:, :2] = aligned[:, :2] @ rot.T
        return aligned
