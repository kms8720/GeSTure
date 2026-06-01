import cv2

from gesture_pipeline.camera import open_camera_capture
from gesture_pipeline.overlay import draw_hand_overlay
from gesture_pipeline.skeleton import MediaPipeHandExtractor


def preview_skeleton(camera_index: int) -> None:
    cap, backend = open_camera_capture(camera_index)
    extractor = MediaPipeHandExtractor(max_hands=1)
    print(f"camera index {camera_index} opened with {backend}")
    print("press q in the preview window to stop")

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError("Failed to read camera frame")

            landmarks = extractor.extract(frame)
            preview = draw_hand_overlay(frame, landmarks)
            cv2.imshow("ACC GeSTure skeleton preview", preview)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        extractor.close()
        cap.release()
        cv2.destroyAllWindows()
