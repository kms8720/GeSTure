import argparse
from pathlib import Path

from gesture_pipeline.config import PipelineConfig
from gesture_pipeline.dataset_capture import capture_reference_samples
from gesture_pipeline.diagnostics import (
    check_camera,
    check_imports,
    check_python,
    print_check_report,
    scan_cameras,
)
from gesture_pipeline.live_compose import compose_live
from gesture_pipeline.live_recognition import recognize_live
from gesture_pipeline.llm import DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, DisabledWordCorrector, OllamaWordCorrector
from gesture_pipeline.pipeline import GesturePipeline
from gesture_pipeline.preview import preview_skeleton
from gesture_pipeline.recognizer import PlaceholderRecognizer, ReferenceRecognizer
from gesture_pipeline.screen_check import check_screen_image
from gesture_pipeline.skeleton import SkeletonNormalizer
from gesture_pipeline.virtual_skeleton import (
    DEFAULT_VIRTUAL_SKELETON_URL,
    capture_virtual_reference_samples,
    check_virtual_skeleton,
)

DEFAULT_REFERENCE_PATH = Path("jamo-recognition/data/reference_samples.jsonl")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the ACC GeSTure recognition pipeline.")
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="Run the 1-second capture pipeline.")
    add_run_arguments(run_parser)

    check_parser = subparsers.add_parser("check", help="Check Python, packages, camera, and skeleton detection.")
    check_parser.add_argument("--camera", type=int, default=0, help="Camera index.")
    check_parser.add_argument("--no-camera", action="store_true", help="Only check Python and package imports.")
    check_parser.add_argument("--scan-cameras", action="store_true", help="Scan camera indices before checking one camera.")
    check_parser.add_argument("--max-camera-index", type=int, default=3, help="Highest camera index to scan.")
    check_parser.add_argument("--save-frame", type=Path, default=None, help="Optional path to save one camera frame.")
    check_parser.add_argument("--duration", type=float, default=0.0, help="Seconds to sample camera frames.")
    check_parser.add_argument("--preview", action="store_true", help="Show a live skeleton preview while checking.")

    preview_parser = subparsers.add_parser("preview", help="Show a live camera window with skeleton lines.")
    preview_parser.add_argument("--camera", type=int, default=0, help="Camera index.")

    recognize_parser = subparsers.add_parser("recognize", help="Show live recognition labels on the camera feed.")
    recognize_parser.add_argument("--camera", type=int, default=0, help="Camera index.")
    recognize_parser.add_argument("--references", type=Path, default=DEFAULT_REFERENCE_PATH)
    recognize_parser.add_argument("--neighbors", type=int, default=3, help="Reference samples to average per label.")
    recognize_parser.add_argument("--duration", type=float, default=0.0, help="Seconds to run; 0 means until space.")

    compose_parser = subparsers.add_parser("compose", help="Build Hangul text from live jamo predictions.")
    compose_parser.add_argument("--camera", type=int, default=0, help="Camera index.")
    compose_parser.add_argument("--references", type=Path, default=DEFAULT_REFERENCE_PATH)
    compose_parser.add_argument("--neighbors", type=int, default=3, help="Reference samples to average per label.")
    compose_parser.add_argument("--duration", type=float, default=0.0, help="Seconds to run; 0 means until space.")
    compose_parser.add_argument("--output", type=Path, default=Path("data/compose_session.jsonl"))
    compose_parser.add_argument("--llm-model", default=DEFAULT_OLLAMA_MODEL, help="Ollama model for Tab finalize.")
    compose_parser.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL, help="Ollama base URL.")
    compose_parser.add_argument("--no-llm", action="store_true", help="Disable LLM correction on Tab finalize.")

    capture_parser = subparsers.add_parser("capture", help="Capture labeled skeleton samples for recognizer work.")
    capture_parser.add_argument("--label", required=True, help="Reference label, such as giyeok, nieun, a, or eo.")
    capture_parser.add_argument("--camera", type=int, default=0, help="Camera index.")
    capture_parser.add_argument("--samples", type=int, default=20, help="Number of detected-hand samples to save.")
    capture_parser.add_argument("--interval", type=float, default=0.25, help="Seconds between saved samples.")
    capture_parser.add_argument("--output", type=Path, default=DEFAULT_REFERENCE_PATH)
    capture_parser.add_argument("--no-preview", action="store_true", help="Disable live skeleton preview.")

    screen_parser = subparsers.add_parser(
        "screen-check",
        help="Run MediaPipe hand detection on a captured virtual-hand screen image.",
    )
    screen_parser.add_argument("--image", type=Path, required=True, help="Screen capture image to inspect.")
    screen_parser.add_argument("--save-overlay", type=Path, default=None, help="Optional output image with overlay.")
    screen_parser.add_argument("--min-detection-confidence", type=float, default=0.5)

    virtual_check_parser = subparsers.add_parser(
        "virtual-check",
        help="Read GLB-derived virtual skeleton landmarks from the virtual hand server.",
    )
    virtual_check_parser.add_argument("--url", default=DEFAULT_VIRTUAL_SKELETON_URL)
    virtual_check_parser.add_argument("--references", type=Path, default=DEFAULT_REFERENCE_PATH)
    virtual_check_parser.add_argument("--neighbors", type=int, default=3, help="Reference samples to average per label.")
    virtual_check_parser.add_argument("--no-recognizer", action="store_true", help="Only validate skeleton input.")

    virtual_capture_parser = subparsers.add_parser(
        "virtual-capture",
        help="Capture virtual skeleton reference samples from the virtual hand server.",
    )
    virtual_capture_parser.add_argument("--label", required=True)
    virtual_capture_parser.add_argument("--url", default=DEFAULT_VIRTUAL_SKELETON_URL)
    virtual_capture_parser.add_argument("--samples", type=int, default=20)
    virtual_capture_parser.add_argument("--interval", type=float, default=0.25)
    virtual_capture_parser.add_argument("--output", type=Path, default=Path("data/virtual_reference_samples.jsonl"))

    add_run_arguments(parser)
    return parser


def add_run_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--camera", type=int, default=0, help="Camera index.")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between captures.")
    parser.add_argument("--output", type=Path, default=Path("data/session.jsonl"))
    parser.add_argument("--no-preview", action="store_true", help="Disable camera preview window.")
    parser.add_argument("--references", type=Path, default=DEFAULT_REFERENCE_PATH)
    parser.add_argument("--neighbors", type=int, default=3, help="Reference samples to average per label.")


def main() -> None:
    args = build_parser().parse_args()
    if args.command == "check":
        items = [check_python(), *check_imports()]
        if not args.no_camera:
            if args.scan_cameras:
                items.extend(scan_cameras(args.max_camera_index))
            items.extend(check_camera(args.camera, args.save_frame, args.duration, args.preview))
        ok = print_check_report(items)
        raise SystemExit(0 if ok else 1)
    if args.command == "preview":
        preview_skeleton(args.camera)
        return
    if args.command == "recognize":
        recognizer = build_recognizer(args.references, args.neighbors)
        recognize_live(args.camera, recognizer, args.duration)
        return
    if args.command == "compose":
        recognizer = build_recognizer(args.references, args.neighbors)
        corrector = (
            DisabledWordCorrector()
            if args.no_llm
            else OllamaWordCorrector(base_url=args.ollama_url, model=args.llm_model)
        )
        compose_live(args.camera, recognizer, args.duration, args.output, corrector)
        return
    if args.command == "capture":
        capture_reference_samples(
            label=args.label,
            camera_index=args.camera,
            output_path=args.output,
            samples=args.samples,
            interval_sec=args.interval,
            show_preview=not args.no_preview,
        )
        return
    if args.command == "screen-check":
        result = check_screen_image(
            image_path=args.image,
            save_overlay=args.save_overlay,
            min_detection_confidence=args.min_detection_confidence,
        )
        ok = print_check_report(result.items)
        raise SystemExit(0 if ok else 1)
    if args.command == "virtual-check":
        items, hand = check_virtual_skeleton(args.url)
        ok = print_check_report(items)
        if ok and hand is not None and not args.no_recognizer:
            normalizer = SkeletonNormalizer()
            recognizer = build_recognizer(args.references, args.neighbors)
            prediction = recognizer.predict(normalizer.normalize(hand))
            print(f"prediction: {prediction.label} ({prediction.confidence:.2f})")
        raise SystemExit(0 if ok else 1)
    if args.command == "virtual-capture":
        capture_virtual_reference_samples(
            label=args.label,
            url=args.url,
            output_path=args.output,
            samples=args.samples,
            interval_sec=args.interval,
        )
        return

    config = PipelineConfig(
        camera_index=args.camera,
        sample_interval_sec=args.interval,
        output_path=args.output,
        show_preview=not args.no_preview,
    )
    recognizer = build_recognizer(args.references, args.neighbors)
    pipeline = GesturePipeline(config=config, recognizer=recognizer)
    pipeline.run()


def build_recognizer(reference_path: Path, neighbors: int):
    if not reference_path.exists():
        print(f"reference file not found: {reference_path}; using placeholder recognizer")
        return PlaceholderRecognizer()
    try:
        recognizer = ReferenceRecognizer.from_jsonl(reference_path, neighbors=neighbors)
    except ValueError as exc:
        print(f"reference recognizer unavailable: {exc}; using placeholder recognizer")
        return PlaceholderRecognizer()
    print(f"loaded {len(recognizer.samples)} reference samples from {reference_path}")
    return recognizer


if __name__ == "__main__":
    main()
