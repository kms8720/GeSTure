from dataclasses import dataclass
from importlib import import_module
from pathlib import Path
import platform
import sys

import cv2

from gesture_pipeline.camera import CAMERA_BACKENDS
from gesture_pipeline.skeleton import MediaPipeHandExtractor, SkeletonNormalizer


@dataclass(frozen=True)
class CheckItem:
    name: str
    ok: bool
    detail: str


def check_python() -> CheckItem:
    version = ".".join(str(part) for part in sys.version_info[:3])
    ok = (3, 10) <= sys.version_info[:2] < (3, 13)
    detail = f"{version} on {platform.system()}"
    if not ok:
        detail += "; use Python 3.10, 3.11, or 3.12 for MediaPipe legacy Hands support"
    return CheckItem("python", ok, detail)


def check_imports() -> list[CheckItem]:
    modules = ["cv2", "mediapipe", "numpy", "pydantic"]
    items: list[CheckItem] = []
    for module_name in modules:
        try:
            module = import_module(module_name)
            version = getattr(module, "__version__", "installed")
            if module_name == "mediapipe" and not hasattr(module, "solutions"):
                items.append(
                    CheckItem(
                        module_name,
                        False,
                        f"{version}; missing mp.solutions, use Python 3.10-3.12 or migrate to MediaPipe Tasks",
                    )
                )
            else:
                items.append(CheckItem(module_name, True, str(version)))
        except Exception as exc:
            items.append(CheckItem(module_name, False, f"{type(exc).__name__}: {exc}"))
    return items


def check_camera(camera_index: int, save_frame: Path | None = None) -> list[CheckItem]:
    items: list[CheckItem] = []
    cap = None
    backend_name = ""
    tried: list[str] = []
    for name, backend in CAMERA_BACKENDS:
        tried.append(name)
        candidate = cv2.VideoCapture(camera_index, backend)
        if candidate.isOpened():
            cap = candidate
            backend_name = name
            break
        candidate.release()

    if cap is None:
        return [CheckItem("camera", False, f"could not open index {camera_index}; tried {', '.join(tried)}")]

    try:
        ok, frame = cap.read()
    finally:
        cap.release()

    if not ok or frame is None:
        return [CheckItem("camera", False, f"opened index {camera_index}, but frame read failed")]

    height, width = frame.shape[:2]
    items.append(CheckItem("camera", True, f"index {camera_index}, backend {backend_name}, frame {width}x{height}"))

    if save_frame is not None:
        save_frame.parent.mkdir(parents=True, exist_ok=True)
        saved = cv2.imwrite(str(save_frame), frame)
        items.append(CheckItem("save_frame", saved, str(save_frame)))

    try:
        extractor = MediaPipeHandExtractor(max_hands=1)
        raw_hand = extractor.extract(frame)
    except Exception as exc:
        items.append(CheckItem("hand_skeleton", False, f"{type(exc).__name__}: {exc}"))
        return items
    finally:
        if "extractor" in locals():
            extractor.close()

    if raw_hand is None:
        items.append(CheckItem("hand_skeleton", False, "no hand detected in the sampled frame"))
        return items

    normalized = SkeletonNormalizer().normalize(raw_hand)
    items.append(
        CheckItem(
            "hand_skeleton",
            True,
            f"{normalized.handedness}, landmarks={normalized.points.shape[0]}",
        )
    )
    return items


def scan_cameras(max_index: int) -> list[CheckItem]:
    items: list[CheckItem] = []
    for camera_index in range(max_index + 1):
        opened: list[str] = []
        for name, backend in CAMERA_BACKENDS:
            cap = cv2.VideoCapture(camera_index, backend)
            if cap.isOpened():
                opened.append(name)
            cap.release()
        detail = f"index {camera_index}: {', '.join(opened)}" if opened else f"index {camera_index}: not available"
        items.append(CheckItem(f"camera_scan_{camera_index}", bool(opened), detail))
    return items


def print_check_report(items: list[CheckItem]) -> bool:
    all_ok = True
    for item in items:
        mark = "OK" if item.ok else "FAIL"
        print(f"[{mark}] {item.name}: {item.detail}")
        all_ok = all_ok and item.ok
    return all_ok
