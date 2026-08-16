"""
reference_samples.jsonl (31 자모 x 20 샘플, 실제 사람 손 MediaPipe 캡처)에서
- 손가락별 굽힘(flexion)
- 손가락별 벌림(abduction)
- 손 방향(orientation)
을 뽑아내고, "손 방향을 버렸을 때 어떤 자모들이 구분 불가능해지는가"를 실측으로 판정한다.

MediaPipe 21 landmark 인덱스:
  0 wrist
  1-4   thumb  CMC, MCP, IP, TIP
  5-8   index  MCP, PIP, DIP, TIP
  9-12  middle MCP, PIP, DIP, TIP
  13-16 ring   MCP, PIP, DIP, TIP
  17-20 pinky  MCP, PIP, DIP, TIP
"""
import json
import collections
import itertools
import numpy as np

PATH = "jamo-recognition/data/reference_samples.jsonl"

FINGER_CHAINS = {
    "thumb":  [1, 2, 3, 4],
    "index":  [5, 6, 7, 8],
    "middle": [9, 10, 11, 12],
    "ring":   [13, 14, 15, 16],
    "pinky":  [17, 18, 19, 20],
}
FINGERS = list(FINGER_CHAINS)
MCP_IDS = {"thumb": 1, "index": 5, "middle": 9, "ring": 13, "pinky": 17}
TIP_IDS = {"thumb": 4, "index": 8, "middle": 12, "ring": 16, "pinky": 20}


def joint_angle(a, b, c):
    """b에서 꺾이는 각도 (라디안). 펴짐 = pi, 완전히 접힘 -> 0에 가까움."""
    v1, v2 = a - b, c - b
    n1, n2 = np.linalg.norm(v1), np.linalg.norm(v2)
    if n1 < 1e-9 or n2 < 1e-9:
        return np.pi
    cos = np.clip(np.dot(v1, v2) / (n1 * n2), -1.0, 1.0)
    return float(np.arccos(cos))


def flexion_0_100(points, finger):
    """
    관절 각도 합으로 굽힘을 재고 0~100으로 사상한다.
    로봇손 리그 규약과 동일: 100 = 완전히 펴짐, 0 = 완전히 접힘.
    """
    chain = FINGER_CHAINS[finger]
    angles = [
        joint_angle(points[chain[i]], points[chain[i + 1]], points[chain[i + 2]])
        for i in range(len(chain) - 2)
    ]
    # 각 관절: pi(펴짐) -> 1.0, pi/2 이하(접힘) -> 0.0
    scores = [np.clip((a - np.pi / 2) / (np.pi / 2), 0.0, 1.0) for a in angles]
    return float(np.mean(scores) * 100.0)


def palm_basis(points):
    """손바닥 좌표계: origin=wrist, x=검지MCP->소지MCP, y=wrist->중지MCP, z=법선."""
    wrist = points[0]
    y = points[9] - wrist
    y /= (np.linalg.norm(y) + 1e-9)
    across = points[17] - points[5]
    z = np.cross(across, y)
    z /= (np.linalg.norm(z) + 1e-9)
    x = np.cross(y, z)
    x /= (np.linalg.norm(x) + 1e-9)
    return wrist, np.stack([x, y, z])


def abduction_0_100(points):
    """인접 손가락 사이 벌림. 손바닥 평면에 투영한 손가락 방향들 사이 각도."""
    wrist, basis = palm_basis(points)
    dirs = {}
    for f in FINGERS:
        v = points[TIP_IDS[f]] - points[MCP_IDS[f]]
        local = basis @ v
        planar = np.array([local[0], local[1]])
        n = np.linalg.norm(planar)
        dirs[f] = planar / n if n > 1e-9 else np.array([0.0, 1.0])

    out = {}
    order = ["thumb", "index", "middle", "ring", "pinky"]
    for i, f in enumerate(order):
        neigh = []
        if i > 0:
            neigh.append(order[i - 1])
        if i < len(order) - 1:
            neigh.append(order[i + 1])
        gaps = []
        for g in neigh:
            cos = np.clip(np.dot(dirs[f], dirs[g]), -1.0, 1.0)
            gaps.append(float(np.arccos(cos)))
        # 0 rad -> 0, 0.6 rad 이상 -> 100
        out[f] = float(np.clip(np.mean(gaps) / 0.6, 0.0, 1.0) * 100.0)
    return out


def orientation(points, handedness):
    """
    손 전체 방향을 월드(카메라) 기준으로 기술한다.
    - point_dir: 손가락이 가리키는 방향 (wrist -> 중지 MCP)
    - palm_normal: 손바닥 법선
    왼손 캡처는 x를 뒤집어 오른손 기준으로 정렬한다.
    """
    p = points.copy()
    if handedness == "Left":
        p[:, 0] *= -1.0
    wrist = p[0]
    point_dir = p[9] - wrist
    point_dir /= (np.linalg.norm(point_dir) + 1e-9)
    across = p[17] - p[5]
    normal = np.cross(across, p[9] - wrist)
    normal /= (np.linalg.norm(normal) + 1e-9)
    return point_dir, normal


def main():
    by_label = collections.defaultdict(list)
    for line in open(PATH):
        line = line.strip()
        if not line:
            continue
        o = json.loads(line)
        pts = np.array(o["raw_points"], dtype=float)
        flex = {f: flexion_0_100(pts, f) for f in FINGERS}
        abd = abduction_0_100(pts)
        pdir, pnorm = orientation(pts, o.get("handedness", "Right"))
        by_label[o["label"]].append(
            {"flex": flex, "abd": abd, "point_dir": pdir, "normal": pnorm}
        )

    labels = sorted(by_label)
    print(f"자모 {len(labels)}개, 샘플 {sum(len(v) for v in by_label.values())}개\n")

    # ---- 자모별 평균 프로파일 ----
    profile = {}
    print("=" * 92)
    print("자모별 평균 굽힘 (100=펴짐, 0=접힘)  |  벌림 평균  |  샘플 내 굽힘 표준편차")
    print("=" * 92)
    print(f"{'자모':<5}{'엄지':>7}{'검지':>7}{'중지':>7}{'약지':>7}{'소지':>7}   {'벌림':>6}   {'σ(굽힘)':>8}")
    for lab in labels:
        rows = by_label[lab]
        fv = np.array([[r["flex"][f] for f in FINGERS] for r in rows])
        av = np.array([[r["abd"][f] for f in FINGERS] for r in rows])
        mean_f = fv.mean(axis=0)
        std_f = fv.std(axis=0).mean()
        profile[lab] = {
            "flex": mean_f,
            "abd": av.mean(axis=0),
            "flex_std": fv.std(axis=0),
            "point_dir": np.mean([r["point_dir"] for r in rows], axis=0),
            "normal": np.mean([r["normal"] for r in rows], axis=0),
        }
        print(
            f"{lab:<5}" + "".join(f"{v:7.1f}" for v in mean_f)
            + f"   {av.mean():6.1f}   {std_f:8.1f}"
        )

    # ---- 굽힘만으로 자모쌍이 얼마나 떨어져 있는가 ----
    print("\n" + "=" * 92)
    print("손 방향을 버렸을 때: 5차원 굽힘 공간에서 가장 가까운 자모쌍 (거리 오름차순)")
    print("=" * 92)
    pairs = []
    for a, b in itertools.combinations(labels, 2):
        d_flex = float(np.linalg.norm(profile[a]["flex"] - profile[b]["flex"]))
        d_abd = float(np.linalg.norm(profile[a]["abd"] - profile[b]["abd"]))
        cos_dir = float(np.dot(profile[a]["point_dir"], profile[b]["point_dir"]))
        cos_nrm = float(np.dot(profile[a]["normal"], profile[b]["normal"]))
        pairs.append((d_flex, d_abd, cos_dir, cos_nrm, a, b))
    pairs.sort()

    print(f"{'자모쌍':<9}{'굽힘거리':>9}{'벌림거리':>9}{'방향유사':>9}{'법선유사':>9}   판정")
    for d_flex, d_abd, cos_dir, cos_nrm, a, b in pairs[:30]:
        if d_flex < 15 and d_abd < 20:
            verdict = "굽힘/벌림으로 구분 불가 -> 같은 클래스"
        elif d_flex < 15:
            verdict = "굽힘 동일, 벌림으로만 구분"
        else:
            verdict = "구분 가능"
        print(
            f"{a}-{b:<7}{d_flex:9.1f}{d_abd:9.1f}{cos_dir:9.2f}{cos_nrm:9.2f}   {verdict}"
        )

    # ---- 샘플 내 산포와 비교 (구분 가능성의 현실적 기준) ----
    within = np.mean([profile[l]["flex_std"].mean() for l in labels])
    print(f"\n같은 자모 안에서의 평균 굽힘 표준편차: {within:.1f}")
    print("→ 자모쌍 굽힘거리가 이 값의 2배 미만이면 실전에서 오인식된다고 봐야 한다.")
    threshold = within * 2
    print(f"→ 실전 구분 임계값: {threshold:.1f}\n")

    inseparable = [(a, b) for d, _, _, _, a, b in pairs if d < threshold]
    print(f"임계값 미만인 자모쌍: {len(inseparable)}개")

    # ---- 연결 요소로 클래스 만들기 ----
    parent = {l: l for l in labels}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[ry] = rx

    for a, b in inseparable:
        union(a, b)

    groups = collections.defaultdict(list)
    for l in labels:
        groups[find(l)].append(l)

    print("\n" + "=" * 92)
    print(f"실측 기반 포즈 클래스: {len(groups)}개")
    print("=" * 92)
    for i, (root, members) in enumerate(sorted(groups.items(), key=lambda kv: -len(kv[1])), 1):
        mean_flex = np.mean([profile[m]["flex"] for m in members], axis=0)
        print(
            f"{i:2d}. {'/'.join(members):<14} ({len(members)}자)  "
            f"굽힘 [{', '.join(f'{v:.0f}' for v in mean_flex)}]"
        )

    sizes = collections.Counter(len(v) for v in groups.values())
    print(f"\n클래스 크기 분포: {dict(sorted(sizes.items()))}")
    print(f"최대 클래스 크기: {max(len(v) for v in groups.values())}자")


if __name__ == "__main__":
    main()
