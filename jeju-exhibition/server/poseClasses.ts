// 이 파일은 생성물이다. 직접 수정하지 말고 docs/pose-derivation.md의 절차로 재생성하라.
//
// 출처: jamo-recognition/data/reference_samples.jsonl
//       31개 자모 x 20샘플 = 620개 실측 MediaPipe 손 landmark (2026-06-02 캡처)
//
// 파생 과정:
//   1. 각 샘플에서 손가락별 관절 각도로 굽힘값(0~100, 100=펴짐)을 계산
//   2. 자모별 평균 굽힘 프로파일을 구함
//   3. 5차원 굽힘 공간에서 거리 22 미만인 자모끼리 병합 -> 17개 포즈 클래스
//      (관객은 굽힘 5개만 제어하므로 굽힘만으로 구분 가능한 것이 클래스가 된다.
//       손 방향으로만 갈리는 ㅏ/ㅓ, ㅗ/ㅜ 같은 자모는 한 클래스에 후보로 공존한다.)
//   4. 클래스별 bias를 학습해 각 클래스의 도달 확률을 균등화
//      (보정 전 최대/최소 점유율 20.8배 -> 보정 후 1.0배)

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

export type Finger = (typeof FINGERS)[number];
export type HandState = Record<Finger, number>;
export type FingerVector = Record<Finger, number>;
export type Orientation = { yaw: number; pitch: number; roll: number };

export type PoseClass = {
  /** 안정적인 식별자. 자모 로마자 표기를 이어붙인 것 */
  id: string;
  /** 이 포즈로 갈 수 있는 자모 후보들. 2개 이상이면 손 방향으로만 갈리는 자모들이다 */
  jamo: string[];
  /** 실측 지화 평균 굽힘. nearest-class 판정의 중심점 */
  flexion: FingerVector;
  /** 손가락 벌림 프리셋. 관객이 제어하지 않고 렌더에만 쓰인다 */
  abduction: FingerVector;
  /** 손 전체 방향 프리셋. 클래스 대표값 */
  orientation: Orientation;
  /** 도달 확률 균등화 보정값. 거리에서 빼는 방식으로 적용한다 */
  bias: number;
  /** 슬라이더를 균등 무작위로 움직였을 때 이 클래스가 나올 확률(%) */
  reachShare: number;
  /** 후보 자모 각각의 실측 손 방향. 단어 확정 후 되짚어 보여줄 때 쓴다 */
  perJamoOrientation: Record<string, Orientation>;
};

export const POSE_CLASSES: PoseClass[] = [
  {
    id: 'giyeok-nieun-a-o-u-eu',
    jamo: ['ㄱ', 'ㄴ', 'ㅏ', 'ㅗ', 'ㅜ', 'ㅡ'],
    flexion: { thumb: 68.8, index: 95.3, middle: 45.1, ring: 43.5, pinky: 46.3 },
    abduction: { thumb: 66.1, index: 100.0, middle: 99.1, ring: 68.5, pinky: 44.3 },
    orientation: { yaw: -1.1526, pitch: 0.5697, roll: -0.9423 },
    bias: -2.68,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㄱ': { yaw: -1.5637, pitch: 1.0188, roll: -2.3282 },
      'ㄴ': { yaw: -1.4569, pitch: 0.7043, roll: -0.1955 },
      'ㅏ': { yaw: 1.0742, pitch: -0.8922, roll: -0.4471 },
      'ㅗ': { yaw: -1.6232, pitch: 0.7156, roll: 0.5904 },
      'ㅜ': { yaw: -1.9131, pitch: 1.0844, roll: -2.7448 },
      'ㅡ': { yaw: -1.433, pitch: 0.7875, roll: -0.5289 },
    }
  },
  {
    id: 'digeut-siot-jieut-ya-yo-yu',
    jamo: ['ㄷ', 'ㅅ', 'ㅈ', 'ㅑ', 'ㅛ', 'ㅠ'],
    flexion: { thumb: 68.4, index: 97.2, middle: 95.9, ring: 41.6, pinky: 42.1 },
    abduction: { thumb: 81.3, index: 67.2, middle: 94.8, ring: 99.5, pinky: 56.3 },
    orientation: { yaw: -1.0814, pitch: 0.6034, roll: -1.3219 },
    bias: 10.65,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㄷ': { yaw: -1.2868, pitch: 0.8003, roll: -0.6717 },
      'ㅅ': { yaw: -1.6804, pitch: 1.0869, roll: -2.4919 },
      'ㅈ': { yaw: -1.5238, pitch: 0.9661, roll: -2.4014 },
      'ㅑ': { yaw: 1.1595, pitch: -0.9293, roll: -0.5165 },
      'ㅛ': { yaw: -1.5688, pitch: 0.6286, roll: 0.5885 },
      'ㅠ': { yaw: -1.5882, pitch: 1.0678, roll: -2.4382 },
    }
  },
  {
    id: 'ae-oe-wi-ui',
    jamo: ['ㅐ', 'ㅚ', 'ㅟ', 'ㅢ'],
    flexion: { thumb: 62.0, index: 97.4, middle: 40.7, ring: 41.5, pinky: 92.9 },
    abduction: { thumb: 35.8, index: 93.6, middle: 99.6, ring: 87.7, pinky: 88.3 },
    orientation: { yaw: -0.825, pitch: 0.4031, roll: -0.5816 },
    bias: 2.04,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅐ': { yaw: 1.4201, pitch: -0.8299, roll: -0.509 },
      'ㅚ': { yaw: -1.5437, pitch: 0.6153, roll: 0.7373 },
      'ㅟ': { yaw: -1.7738, pitch: 1.1044, roll: -2.4548 },
      'ㅢ': { yaw: -1.4027, pitch: 0.7227, roll: -0.0999 },
    }
  },
  {
    id: 'rieul-tieut',
    jamo: ['ㄹ', 'ㅌ'],
    flexion: { thumb: 60.2, index: 94.2, middle: 91.6, ring: 88.8, pinky: 45.6 },
    abduction: { thumb: 98.7, index: 97.9, middle: 69.5, ring: 96.0, pinky: 97.3 },
    orientation: { yaw: -1.2632, pitch: 0.6619, roll: -0.3831 },
    bias: 15.52,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㄹ': { yaw: -1.3258, pitch: 0.7111, roll: -0.4543 },
      'ㅌ': { yaw: -1.2006, pitch: 0.6126, roll: -0.3119 },
    }
  },
  {
    id: 'mieum',
    jamo: ['ㅁ'],
    flexion: { thumb: 34.6, index: 41.8, middle: 20.2, ring: 39.4, pinky: 45.1 },
    abduction: { thumb: 65.5, index: 45.1, middle: 100.0, ring: 100.0, pinky: 22.4 },
    orientation: { yaw: 1.0889, pitch: -0.9481, roll: -0.3984 },
    bias: -25.6,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅁ': { yaw: 1.0889, pitch: -0.9481, roll: -0.3984 },
    }
  },
  {
    id: 'bieup',
    jamo: ['ㅂ'],
    flexion: { thumb: 41.2, index: 95.6, middle: 96.4, ring: 95.9, pinky: 98.1 },
    abduction: { thumb: 12.6, index: 8.9, middle: 2.8, ring: 4.5, pinky: 8.4 },
    orientation: { yaw: 1.3676, pitch: -0.8149, roll: -0.4672 },
    bias: 25.98,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅂ': { yaw: 1.3676, pitch: -0.8149, roll: -0.4672 },
    }
  },
  {
    id: 'ieung',
    jamo: ['ㅇ'],
    flexion: { thumb: 82.1, index: 29.7, middle: 94.9, ring: 96.3, pinky: 95.0 },
    abduction: { thumb: 88.6, index: 90.2, middle: 76.8, ring: 21.7, pinky: 27.3 },
    orientation: { yaw: 0.5975, pitch: -1.0056, roll: -0.0081 },
    bias: 4.73,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅇ': { yaw: 0.5975, pitch: -1.0056, roll: -0.0081 },
    }
  },
  {
    id: 'chieut',
    jamo: ['ㅊ'],
    flexion: { thumb: 90.1, index: 96.0, middle: 96.4, ring: 95.1, pinky: 41.5 },
    abduction: { thumb: 75.2, index: 50.0, middle: 27.3, ring: 100.0, pinky: 100.0 },
    orientation: { yaw: -1.4716, pitch: 0.9614, roll: -2.3213 },
    bias: 23.87,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅊ': { yaw: -1.4716, pitch: 0.9614, roll: -2.3213 },
    }
  },
  {
    id: 'kieuk',
    jamo: ['ㅋ'],
    flexion: { thumb: 89.2, index: 47.8, middle: 94.6, ring: 42.7, pinky: 43.9 },
    abduction: { thumb: 100.0, index: 97.9, middle: 100.0, ring: 100.0, pinky: 9.6 },
    orientation: { yaw: -1.4759, pitch: 0.9502, roll: -2.3225 },
    bias: -9.0,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅋ': { yaw: -1.4759, pitch: 0.9502, roll: -2.3225 },
    }
  },
  {
    id: 'pieup',
    jamo: ['ㅍ'],
    flexion: { thumb: 21.4, index: 39.0, middle: 42.9, ring: 42.7, pinky: 41.7 },
    abduction: { thumb: 67.0, index: 100.0, middle: 100.0, ring: 99.2, pinky: 100.0 },
    orientation: { yaw: 1.2875, pitch: -0.9095, roll: -0.4126 },
    bias: -27.41,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅍ': { yaw: 1.2875, pitch: -0.9095, roll: -0.4126 },
    }
  },
  {
    id: 'hieut',
    jamo: ['ㅎ'],
    flexion: { thumb: 94.7, index: 20.5, middle: 16.6, ring: 20.6, pinky: 27.1 },
    abduction: { thumb: 100.0, index: 100.0, middle: 53.1, ring: 87.3, pinky: 93.7 },
    orientation: { yaw: -0.644, pitch: -0.5039, roll: 0.5968 },
    bias: -19.55,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅎ': { yaw: -0.644, pitch: -0.5039, roll: 0.5968 },
    }
  },
  {
    id: 'yae',
    jamo: ['ㅒ'],
    flexion: { thumb: 63.5, index: 96.5, middle: 95.3, ring: 40.8, pinky: 92.3 },
    abduction: { thumb: 68.5, index: 46.9, middle: 100.0, ring: 100.0, pinky: 100.0 },
    orientation: { yaw: 1.2789, pitch: -0.8737, roll: -0.4061 },
    bias: 17.61,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅒ': { yaw: 1.2789, pitch: -0.8737, roll: -0.4061 },
    }
  },
  {
    id: 'eo',
    jamo: ['ㅓ'],
    flexion: { thumb: 32.7, index: 78.7, middle: 17.1, ring: 17.0, pinky: 24.7 },
    abduction: { thumb: 14.8, index: 100.0, middle: 100.0, ring: 99.2, pinky: 98.3 },
    orientation: { yaw: -0.5341, pitch: -0.4777, roll: 0.4356 },
    bias: -13.17,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅓ': { yaw: -0.5341, pitch: -0.4777, roll: 0.4356 },
    }
  },
  {
    id: 'e',
    jamo: ['ㅔ'],
    flexion: { thumb: 55.9, index: 93.3, middle: 74.3, ring: 69.0, pinky: 53.8 },
    abduction: { thumb: 11.5, index: 100.0, middle: 100.0, ring: 95.5, pinky: 95.2 },
    orientation: { yaw: 0.242, pitch: -1.0325, roll: -0.3197 },
    bias: 9.03,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅔ': { yaw: 0.242, pitch: -1.0325, roll: -0.3197 },
    }
  },
  {
    id: 'yeo',
    jamo: ['ㅕ'],
    flexion: { thumb: 69.7, index: 89.0, middle: 60.1, ring: 68.4, pinky: 69.4 },
    abduction: { thumb: 98.2, index: 100.0, middle: 97.1, ring: 58.5, pinky: 8.9 },
    orientation: { yaw: 1.2835, pitch: -0.4617, roll: -0.2784 },
    bias: 3.77,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅕ': { yaw: 1.2835, pitch: -0.4617, roll: -0.2784 },
    }
  },
  {
    id: 'ye',
    jamo: ['ㅖ'],
    flexion: { thumb: 27.5, index: 91.3, middle: 83.6, ring: 52.2, pinky: 68.5 },
    abduction: { thumb: 54.5, index: 52.7, middle: 100.0, ring: 100.0, pinky: 100.0 },
    orientation: { yaw: 0.6418, pitch: -0.9943, roll: -0.4804 },
    bias: 3.88,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅖ': { yaw: 0.6418, pitch: -0.9943, roll: -0.4804 },
    }
  },
  {
    id: 'i',
    jamo: ['ㅣ'],
    flexion: { thumb: 36.1, index: 46.4, middle: 45.3, ring: 44.1, pinky: 95.1 },
    abduction: { thumb: 100.0, index: 100.0, middle: 34.8, ring: 100.0, pinky: 100.0 },
    orientation: { yaw: 1.2844, pitch: -0.9056, roll: -0.355 },
    bias: -19.68,
    reachShare: 5.88,
    perJamoOrientation: {
      'ㅣ': { yaw: 1.2844, pitch: -0.9056, roll: -0.355 },
    }
  },
];

/** 이 전시가 다루는 자모 31개 */
export const ALL_JAMO = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ', 'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'] as const;

/** 모든 손가락이 이 값 이상이면 rest pose로 보고 자모를 입력하지 않는다.
 *  실측상 rest(100x5)에서 가장 가까운 클래스(ㅂ)까지 거리가 59.3이라 충분히 여유가 있다. */
export const REST_FLEXION_THRESHOLD = 85;

export function createInitialHandState(): HandState
{
  return { thumb: 100, index: 100, middle: 100, ring: 100, pinky: 100 };
}
