export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

export type Finger = (typeof FINGERS)[number];
export type HandState = Record<Finger, number>;
export type FingerBits = Record<Finger, 0 | 1>;

export type BinaryJamoSample = {
  label: string;
  index: number;
  bits: FingerBits;
  values: HandState;
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

export type WordCorrection = {
  rawJamo: string;
  composedText: string;
  correctedWord: string;
  candidates: string[];
  note: string;
};

export const BINARY_JAMO_LABELS = [
  'ㄱ',
  'ㄴ',
  'ㄷ',
  'ㄹ',
  'ㅁ',
  'ㅂ',
  'ㅅ',
  'ㅇ',
  'ㅈ',
  'ㅊ',
  'ㅋ',
  'ㅌ',
  'ㅍ',
  'ㅎ',
  'ㅏ',
  'ㅑ',
  'ㅓ',
  'ㅕ',
  'ㅗ',
  'ㅛ',
  'ㅜ',
  'ㅠ',
  'ㅡ',
  'ㅣ',
  'ㅐ',
  'ㅒ',
  'ㅔ',
  'ㅖ',
  'ㅚ',
  'ㅟ',
  'ㅢ'
] as const;

const SAMPLES_PER_LABEL = 24;
const OPEN_MIN = 80;
const OPEN_MAX = 100;
const CLOSED_MIN = 0;
const CLOSED_MAX = 20;

const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNGSEONG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONGSEONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const CHOSEONG_INDEX = new Map(CHOSEONG.map((jamo, index) => [jamo, index]));
const JUNGSEONG_INDEX = new Map(JUNGSEONG.map((jamo, index) => [jamo, index]));
const JONGSEONG_INDEX = new Map(JONGSEONG.map((jamo, index) => [jamo, index]));

const WORD_CANDIDATES = [
  '강산',
  '감사',
  '기억',
  '마음',
  '미래',
  '바다',
  '사랑',
  '안녕',
  '언어',
  '우리',
  '전시',
  '평화',
  '하늘',
  '함께',
  '희망'
];

export function createInitialHandState(): HandState
{
  return {
    thumb: 100,
    index: 100,
    middle: 100,
    ring: 100,
    pinky: 100
  };
}

export function generateBinaryJamoSamples(): BinaryJamoSample[]
{
  const random = seededRandom(20260608);
  const samples: BinaryJamoSample[] = [];

  BINARY_JAMO_LABELS.forEach((label, index) =>
  {
    const bits = indexToBits(index);

    for (let sampleIndex = 0; sampleIndex < SAMPLES_PER_LABEL; sampleIndex += 1)
    {
      samples.push({
        label,
        index,
        bits,
        values: Object.fromEntries(FINGERS.map((finger) => [
          finger,
          bits[finger] === 1
            ? randomInt(random, OPEN_MIN, OPEN_MAX)
            : randomInt(random, CLOSED_MIN, CLOSED_MAX)
        ])) as HandState
      });
    }
  });

  return samples;
}

export function predictJamo(handState: HandState, samples: BinaryJamoSample[]): JamoPrediction
{
  const bits = handStateToBits(handState);
  const index = bitsToIndex(bits);
  const nearest = findNearestSample(handState, samples);
  const confidence = Math.max(0, Math.min(1, 1 - nearest.distance / 180));

  return {
    status: index >= BINARY_JAMO_LABELS.length ? 'rest' : 'recognized',
    jamo: BINARY_JAMO_LABELS[index] ?? null,
    index,
    bitString: FINGERS.map((finger) => bits[finger]).join(''),
    bits,
    confidence,
    nearestDistance: nearest.distance,
    handState: { ...handState }
  };
}

export function correctWord(tokens: string[]): WordCorrection
{
  const rawJamo = tokens.join('');
  const composedText = composeJamo(tokens);
  const exact = WORD_CANDIDATES.find((candidate) => candidate === composedText);

  if (exact)
  {
    return {
      rawJamo,
      composedText,
      correctedWord: exact,
      candidates: [exact],
      note: 'composed text matched the exhibition vocabulary'
    };
  }

  const ranked = WORD_CANDIDATES
    .map((candidate) => ({
      candidate,
      score: levenshtein(composedText || rawJamo, candidate)
    }))
    .sort((left, right) => left.score - right.score)
    .slice(0, 3)
    .map((entry) => entry.candidate);

  return {
    rawJamo,
    composedText,
    correctedWord: ranked[0] ?? '안녕',
    candidates: ranked.length > 0 ? ranked : ['안녕'],
    note: 'selected nearest meaningful word from local exhibition vocabulary'
  };
}

export function composeJamo(tokens: string[]): string
{
  const output: string[] = [];
  let index = 0;

  while (index < tokens.length)
  {
    const current = tokens[index];
    const nextToken = tokens[index + 1];

    if (CHOSEONG_INDEX.has(current) && nextToken && JUNGSEONG_INDEX.has(nextToken))
    {
      const choseong = current;
      const jungseong = nextToken;
      index += 2;

      let jongseong = '';
      const finalCandidate = tokens[index];
      const following = tokens[index + 1];
      if (finalCandidate && JONGSEONG_INDEX.has(finalCandidate) && !JUNGSEONG_INDEX.has(following ?? ''))
      {
        jongseong = finalCandidate;
        index += 1;
      }

      output.push(composeSyllable(choseong, jungseong, jongseong));
      continue;
    }

    output.push(current);
    index += 1;
  }

  return output.join('');
}

function handStateToBits(handState: HandState): FingerBits
{
  return Object.fromEntries(FINGERS.map((finger) => [
    finger,
    handState[finger] >= 50 ? 1 : 0
  ])) as FingerBits;
}

function indexToBits(index: number): FingerBits
{
  return Object.fromEntries(FINGERS.map((finger, bitIndex) => [
    finger,
    ((index >> bitIndex) & 1) as 0 | 1
  ])) as FingerBits;
}

function bitsToIndex(bits: FingerBits): number
{
  return FINGERS.reduce((total, finger, bitIndex) => total + bits[finger] * 2 ** bitIndex, 0);
}

function findNearestSample(handState: HandState, samples: BinaryJamoSample[]): { sample: BinaryJamoSample; distance: number }
{
  return samples.reduce(
    (nearest, sample) =>
    {
      const distance = Math.sqrt(FINGERS.reduce((sum, finger) =>
      {
        const delta = handState[finger] - sample.values[finger];
        return sum + delta * delta;
      }, 0));

      return distance < nearest.distance ? { sample, distance } : nearest;
    },
    { sample: samples[0], distance: Number.POSITIVE_INFINITY }
  );
}

function composeSyllable(choseong: string, jungseong: string, jongseong: string): string
{
  const choseongIndex = CHOSEONG_INDEX.get(choseong);
  const jungseongIndex = JUNGSEONG_INDEX.get(jungseong);
  const jongseongIndex = JONGSEONG_INDEX.get(jongseong);

  if (choseongIndex === undefined || jungseongIndex === undefined || jongseongIndex === undefined)
  {
    return `${choseong}${jungseong}${jongseong}`;
  }

  return String.fromCharCode(0xac00 + ((choseongIndex * 21) + jungseongIndex) * 28 + jongseongIndex);
}

function levenshtein(left: string, right: string): number
{
  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

  for (let row = 0; row < rows; row += 1)
  {
    matrix[row][0] = row;
  }

  for (let column = 0; column < columns; column += 1)
  {
    matrix[0][column] = column;
  }

  for (let row = 1; row < rows; row += 1)
  {
    for (let column = 1; column < columns; column += 1)
    {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost
      );
    }
  }

  return matrix[rows - 1][columns - 1];
}

function seededRandom(seed: number): () => number
{
  let state = seed >>> 0;
  return () =>
  {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomInt(random: () => number, min: number, max: number): number
{
  return Math.round(min + random() * (max - min));
}
