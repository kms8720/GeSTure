import {
  FINGERS,
  HandState,
  Orientation,
  PoseClass,
  POSE_CLASSES,
  REST_FLEXION_THRESHOLD
} from './poseClasses.js';

export type PoseMatch = {
  classId: string;
  jamo: string[];
  distance: number;
  adjustedDistance: number;
};

export type PoseRecognition = {
  status: 'rest' | 'recognized';
  /** 확정된 포즈 클래스. rest면 null */
  classId: string | null;
  /** 이 포즈가 될 수 있는 자모 후보들. 확정하지 않고 그대로 넘긴다 */
  jamoCandidates: string[];
  /** 렌더링용 프리셋. 관객이 만든 굽힘값은 그대로 두고 이것들만 손에 얹는다 */
  abduction: Record<string, number> | null;
  orientation: Orientation | null;
  distance: number;
  adjustedDistance: number;
  /** 1등과 2등의 거리 차이에서 나온 확신도. 0에 가까우면 두 포즈 경계에 걸쳐 있다는 뜻 */
  confidence: number;
  runnerUpClassId: string | null;
  handState: HandState;
};

const CLASS_BY_ID = new Map(POSE_CLASSES.map((entry) => [entry.id, entry]));

export function getPoseClass(classId: string): PoseClass | undefined
{
  return CLASS_BY_ID.get(classId);
}

export function isRestPose(handState: HandState): boolean
{
  return FINGERS.every((finger) => handState[finger] >= REST_FLEXION_THRESHOLD);
}

function flexionDistance(handState: HandState, poseClass: PoseClass): number
{
  return Math.sqrt(FINGERS.reduce((sum, finger) =>
  {
    const delta = handState[finger] - poseClass.flexion[finger];
    return sum + delta * delta;
  }, 0));
}

/**
 * 굽힘 5개 값으로 포즈 클래스를 고른다.
 *
 * bias를 거리에서 빼는 이유: 실측 지화 포즈를 그대로 Voronoi로 쓰면 5차원 공간의
 * 가운데에 있는 포즈(ㅍ, ㅁ 등)가 공간의 대부분을 차지하고 구석에 있는 포즈(ㅂ, ㅊ)는
 * 사실상 도달 불가능해진다. 실측 기준 최대/최소 점유율이 20.8배였다.
 * bias는 각 클래스의 도달 확률이 균등해지도록 학습된 값이며 1.0배까지 잡아준다.
 */
export function rankPoses(handState: HandState): PoseMatch[]
{
  return POSE_CLASSES
    .map((poseClass) =>
    {
      const distance = flexionDistance(handState, poseClass);
      return {
        classId: poseClass.id,
        jamo: poseClass.jamo,
        distance,
        adjustedDistance: distance - poseClass.bias
      };
    })
    .sort((left, right) => left.adjustedDistance - right.adjustedDistance);
}

export function recognizePose(handState: HandState): PoseRecognition
{
  const ranked = rankPoses(handState);
  const best = ranked[0];
  const runnerUp = ranked[1];

  if (isRestPose(handState))
  {
    return {
      status: 'rest',
      classId: null,
      jamoCandidates: [],
      abduction: null,
      orientation: null,
      distance: best.distance,
      adjustedDistance: best.adjustedDistance,
      confidence: 0,
      runnerUpClassId: runnerUp?.classId ?? null,
      handState: { ...handState }
    };
  }

  const poseClass = CLASS_BY_ID.get(best.classId);
  const margin = runnerUp ? runnerUp.adjustedDistance - best.adjustedDistance : 40;

  return {
    status: 'recognized',
    classId: best.classId,
    jamoCandidates: best.jamo,
    abduction: poseClass ? { ...poseClass.abduction } : null,
    orientation: poseClass ? { ...poseClass.orientation } : null,
    distance: best.distance,
    adjustedDistance: best.adjustedDistance,
    confidence: Math.max(0, Math.min(1, margin / 40)),
    runnerUpClassId: runnerUp?.classId ?? null,
    handState: { ...handState }
  };
}

/**
 * 관객 5명이 동시에 슬라이더를 움직이면 경계 근처에서 클래스가 빠르게 튄다.
 * 같은 클래스가 holdMs 동안 연속으로 유지될 때만 확정으로 승격시킨다.
 *
 * ACC 버전에서 미해결로 남아 있던 debounce 항목을 여기서는 인식기 안에 넣었다.
 */
export class PoseStabilizer
{
  private candidateId: string | null = null;
  private candidateSince = 0;
  private committedId: string | null = null;

  constructor(private readonly holdMs: number = 400) {}

  /** @returns 이번 호출로 새로 확정된 클래스. 확정 변화가 없으면 null */
  update(recognition: PoseRecognition, nowMs: number): string | null
  {
    const incoming = recognition.status === 'rest' ? null : recognition.classId;

    if (incoming !== this.candidateId)
    {
      this.candidateId = incoming;
      this.candidateSince = nowMs;
      return null;
    }

    if (incoming === this.committedId)
    {
      return null;
    }

    if (nowMs - this.candidateSince >= this.holdMs)
    {
      this.committedId = incoming;
      return incoming;
    }

    return null;
  }

  get committed(): string | null
  {
    return this.committedId;
  }

  reset(): void
  {
    this.candidateId = null;
    this.candidateSince = 0;
    this.committedId = null;
  }
}
