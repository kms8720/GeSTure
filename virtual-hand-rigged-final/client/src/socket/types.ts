export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

export type HandState = Record<FingerName, number>;

export type ControllerState = Record<FingerName, boolean>;

export type FingerBits = Record<FingerName, 0 | 1>;

export type VirtualSkeletonPoint = [number, number, number];

export type VirtualSkeleton = {
  source: 'virtual-hand-rigged-final';
  handedness: 'Right' | 'Left' | 'Unknown';
  points: VirtualSkeletonPoint[];
  timestamp: string;
};

export type JamoPrediction = {
  status: 'recognized' | 'rest';
  jamo: string | null;
  index: number;
  bitString: string;
  bits: FingerBits;
  confidence: number;
  nearestDistance: number;
  handState: HandState;
};

export type RecognitionState = {
  current: JamoPrediction;
  tokens: string[];
  rawJamo: string;
  composedText: string;
  correctedWord: string;
  correctedWords: string[];
  candidates: string[];
  finalized: boolean;
  note: string;
  samplesPerLabel: number;
  updatedAt: string;
};

export const INITIAL_HAND_STATE: HandState = {
  thumb: 100,
  index: 100,
  middle: 100,
  ring: 100,
  pinky: 100
};

export const INITIAL_CONTROLLER_STATE: ControllerState = {
  thumb: false,
  index: false,
  middle: false,
  ring: false,
  pinky: false
};

export const FINGER_LABELS: Record<FingerName, string> = {
  thumb: '엄지',
  index: '검지',
  middle: '중지',
  ring: '약지',
  pinky: '새끼'
};

export const FINGER_ORDER: FingerName[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export const INITIAL_RECOGNITION_STATE: RecognitionState = {
  current: {
    status: 'rest',
    jamo: null,
    index: 31,
    bitString: '11111',
    bits: {
      thumb: 1,
      index: 1,
      middle: 1,
      ring: 1,
      pinky: 1
    },
    confidence: 0,
    nearestDistance: 0,
    handState: INITIAL_HAND_STATE
  },
  tokens: [],
  rawJamo: '',
  composedText: '',
  correctedWord: '',
  correctedWords: [],
  candidates: [],
  finalized: false,
  note: 'waiting for recognition state',
  samplesPerLabel: 24,
  updatedAt: ''
};
