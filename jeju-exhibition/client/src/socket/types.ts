export const FINGER_ORDER = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

export type FingerName = (typeof FINGER_ORDER)[number];
export type HandState = Record<FingerName, number>;
export type FingerVector = Record<FingerName, number>;
export type Orientation = { yaw: number; pitch: number; roll: number };

export const FINGER_LABELS: Record<FingerName, string> = {
  thumb: '엄지',
  index: '검지',
  middle: '중지',
  ring: '약지',
  pinky: '소지'
};

/** 조종기 디스플레이 5대에 붙일 번호. 전시장에서 화면마다 붙여둘 표식이다 */
export const FINGER_STATION: Record<FingerName, number> = {
  thumb: 1,
  index: 2,
  middle: 3,
  ring: 4,
  pinky: 5
};

export type PoseClass = {
  id: string;
  jamo: string[];
  flexion: FingerVector;
  abduction: FingerVector;
  orientation: Orientation;
  bias: number;
  reachShare: number;
  perJamoOrientation: Record<string, Orientation>;
};

export type PoseRecognition = {
  status: 'rest' | 'recognized';
  classId: string | null;
  jamoCandidates: string[];
  abduction: FingerVector | null;
  orientation: Orientation | null;
  distance: number;
  adjustedDistance: number;
  confidence: number;
  runnerUpClassId: string | null;
  handState: HandState;
};

export type JamoSlot = {
  classId: string;
  candidates: string[];
};

export type WordCorrection = {
  slots: JamoSlot[];
  slotSummary: string;
  chosenJamo: string[];
  composedText: string;
  correctedWord: string;
  candidates: string[];
  note: string;
  model: string;
  source: 'llm' | 'vocabulary' | 'none';
  status: 'ok' | 'unavailable' | 'error';
  elapsedMs: number;
};

export type RecognitionState = {
  current: PoseRecognition;
  slots: JamoSlot[];
  slotsNeeded: number;
  correction: WordCorrection | null;
  words: string[];
  correcting: boolean;
  note: string;
  updatedAt: string;
};

export type ControllerState = Record<FingerName, boolean>;

export const INITIAL_HAND_STATE: HandState = {
  thumb: 100, index: 100, middle: 100, ring: 100, pinky: 100
};

export const INITIAL_CONTROLLER_STATE: ControllerState = {
  thumb: false, index: false, middle: false, ring: false, pinky: false
};

export const INITIAL_RECOGNITION_STATE: RecognitionState = {
  current: {
    status: 'rest',
    classId: null,
    jamoCandidates: [],
    abduction: null,
    orientation: null,
    distance: 0,
    adjustedDistance: 0,
    confidence: 0,
    runnerUpClassId: null,
    handState: INITIAL_HAND_STATE
  },
  slots: [],
  slotsNeeded: 6,
  correction: null,
  words: [],
  correcting: false,
  note: '서버 연결을 기다리는 중',
  updatedAt: ''
};
