"""
손 개폐 영상에서 손가락 좌우 벌림(부채꼴)을 측정한다.

VirtualHand.tsx의 spreadOpen / spreadClosed 값이 여기서 나온다.

    ffmpeg -i 영상.mov -vf "fps=10,scale=1080:-1" -q:v 2 frames/f%05d.jpg
    .venv/bin/python jeju-exhibition/scripts/analyze_hand_video.py frames/

왜 이 방식인가
--------------
1. 벌림은 손가락 뿌리관절(MCP)에서 일어난다. 그래서 첫 마디(MCP -> PIP) 방향으로만 잰다.
   tip - MCP 를 쓰면 손가락을 접었을 때 그 벡터가 손바닥 쪽을 향해 각도가 +-180도
   근처로 뒤집히면서 값이 무의미해진다(실제로 검지에서 142도가 나왔다).

2. 기준축을 손 자체에서 잡는다. 왼손/오른손, 손등/손바닥 어느 쪽에서 찍혔는지에
   영향받지 않는다.
       y축 = 손목 -> 중지 MCP
       x축 = 검지 MCP -> 소지 MCP 를 y와 직교화 (검지쪽 -> 소지쪽)
   각도 = atan2(x성분, y성분),  양수 = 소지 쪽

3. 네 손가락 평균을 뺀다. 손을 접으면 네 손가락 각도가 다 같이 한쪽으로 25도쯤
   이동하는데, 이는 손바닥 기준축이 함께 틀어져서 생기는 공통 오프셋이고
   부채꼴과는 무관하다.

리그에 넣을 때
--------------
측정 부호(양수 = 소지쪽)와 GLB 리그의 y축 부호가 반대라 뒤집어야 한다.
엄지는 부채꼴이 아니라 손바닥에서 벌어졌다 붙었다 하므로 변화량만 쓰고 중앙에 맞춘다.
"""
import glob
import json
import math
import os
import sys

import cv2
import numpy as np
import mediapipe as mp

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze_poses import FINGERS, flexion_0_100

ROOT_SEG = {"thumb": (1, 2), "index": (5, 6), "middle": (9, 10),
            "ring": (13, 14), "pinky": (17, 18)}
FOUR = ("index", "middle", "ring", "pinky")
# 손이 카메라에 심하게 기울면 투영이 망가진다
MIN_PALM_RATIO = 0.35


def hand_basis(p):
    y = p[9] - p[0]
    y = y / (np.linalg.norm(y) + 1e-9)
    across = p[17] - p[5]
    x = across - np.dot(across, y) * y
    n = np.linalg.norm(x)
    if n < 1e-9:
        return None
    x = x / n
    return np.stack([x, y, np.cross(x, y)])


def lateral_deg(p, basis, finger):
    a, b = ROOT_SEG[finger]
    local = basis @ (p[b] - p[a])
    return float(np.degrees(np.arctan2(local[0], local[1])))


def collect(frame_dir):
    paths = sorted(glob.glob(os.path.join(frame_dir, "*.jpg")))
    if not paths:
        raise SystemExit(f"프레임이 없다: {frame_dir}")

    hands = mp.solutions.hands.Hands(
        static_image_mode=True, max_num_hands=1,
        min_detection_confidence=0.5, model_complexity=1)

    rows, detected = [], 0
    for path in paths:
        img = cv2.imread(path)
        if img is None:
            continue
        res = hands.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        if not res.multi_hand_landmarks:
            continue
        detected += 1
        p = np.array([[q.x, q.y, q.z] for q in res.multi_hand_landmarks[0].landmark])
        basis = hand_basis(p)
        if basis is None:
            continue
        if np.linalg.norm(p[17] - p[5]) / (np.linalg.norm(p[9] - p[0]) + 1e-9) < MIN_PALM_RATIO:
            continue
        lat = {f: lateral_deg(p, basis, f) for f in FINGERS}
        base = np.mean([lat[f] for f in FOUR])
        rows.append({"open": float(np.mean([flexion_0_100(p, f) for f in FOUR])),
                     "thumb_abs": lat["thumb"],
                     **{f: lat[f] - base for f in FOUR}})

    print(f"프레임 {len(paths)}장, 검출 {detected}장, 사용 {len(rows)}장")
    return rows


def main():
    frame_dir = sys.argv[1] if len(sys.argv) > 1 else "frames"
    rows = collect(frame_dir)

    print("\n개폐 구간별 부채꼴 (네 손가락 평균 대비 편차, 도)")
    print(f"{'개폐':<10}{'n':>6}" + "".join(f"{f:>10}" for f in FOUR) + f"{'폭':>8}{'엄지':>9}")
    table = {}
    for lo, hi in [(0, 25), (25, 45), (45, 65), (65, 85), (85, 101)]:
        sel = [r for r in rows if lo <= r["open"] < hi]
        if len(sel) < 5:
            continue
        v = {f: float(np.mean([r[f] for r in sel])) for f in FOUR}
        th = float(np.mean([r["thumb_abs"] for r in sel]))
        table[(lo, hi)] = (v, th, len(sel))
        print(f"{lo:3d}~{hi-1:3d}   {len(sel):6d}"
              + "".join(f"{v[f]:10.1f}" for f in FOUR)
              + f"{max(v.values()) - min(v.values()):8.1f}{th:9.1f}")

    if len(table) < 2:
        raise SystemExit("양 끝 구간을 잡을 표본이 부족하다. 더 천천히, 더 길게 찍어야 한다.")

    keys = sorted(table)
    cv_, cth, _ = table[keys[0]]
    ov, oth, _ = table[keys[-1]]
    w_open = max(ov.values()) - min(ov.values())
    w_close = max(cv_.values()) - min(cv_.values())

    # 펴짐 구간은 표본이 많고 index -> pinky 가 단조로워 부채꼴 모양의 기준으로 삼는다.
    # 접힘 구간은 표본이 적어 순서가 흔들리므로 모양은 그대로 두고 폭만 줄인다.
    shape = {f: ov[f] / w_open for f in FOUR}

    print(f"\n부채꼴 폭  펴짐 {w_open:.1f}도 -> 접힘 {w_close:.1f}도  (수축비 {w_close / w_open:.2f})")
    print("\nVirtualHand.tsx의 FINGER_RIGS에 넣을 값 (라디안, 측정 부호를 뒤집은 것)")
    out = {}
    for f in FOUR:
        out[f] = {"spreadOpen": round(-math.radians(shape[f] * w_open), 3),
                  "spreadClosed": round(-math.radians(shape[f] * w_close), 3)}
    half = -math.radians(oth - cth) / 2
    out["thumb"] = {"spreadOpen": round(half, 3), "spreadClosed": round(-half, 3)}
    for f in ("thumb",) + FOUR:
        print(f"  {f:<8} spreadOpen: {out[f]['spreadOpen']:>7},  spreadClosed: {out[f]['spreadClosed']:>7}")

    with open("hand_video_spread.json", "w") as fp:
        json.dump(out, fp, indent=2)
    print("\n저장: hand_video_spread.json")


if __name__ == "__main__":
    main()
