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
  model: string;
  status: 'ok' | 'unavailable' | 'error';
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

const DEFAULT_OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
const DEFAULT_FALLBACK_WORD = '안녕';
const KOREAN_WORD_PATTERN = /^[가-힣]{1,4}$/;

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

export async function correctWord(tokens: string[]): Promise<WordCorrection>
{
  const rawJamo = tokens.join('');
  const composedText = composeJamo(tokens);
  const correction = await correctWordWithOllama(rawJamo, composedText);

  return {
    rawJamo,
    composedText,
    ...correction
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

type OllamaCorrectionPayload = Omit<WordCorrection, 'rawJamo' | 'composedText'>;

async function correctWordWithOllama(rawJamo: string, composedText: string): Promise<OllamaCorrectionPayload>
{
  try
  {
    const first = await requestOllamaCorrection(buildCorrectionPrompt(rawJamo, composedText));
    const validated = validateCorrection(first);
    const checked = await requestOllamaCorrection(buildSemanticCheckPrompt(rawJamo, composedText, validated));
    const finalCorrection = validateCorrection(checked);

    return {
      ...finalCorrection,
      model: DEFAULT_OLLAMA_MODEL,
      status: 'ok'
    };
  }
  catch (firstError)
  {
    try
    {
      const repaired = await requestOllamaCorrection(buildRepairPrompt(rawJamo, composedText, String(firstError)));
      const finalCorrection = validateCorrection(repaired);

      return {
        ...finalCorrection,
        note: `repaired after invalid response: ${finalCorrection.note}`,
        model: DEFAULT_OLLAMA_MODEL,
        status: 'ok'
      };
    }
    catch (secondError)
    {
      const unavailable = firstError instanceof TypeError || String(firstError).includes('ECONNREFUSED');
      return {
        correctedWord: DEFAULT_FALLBACK_WORD,
        candidates: [DEFAULT_FALLBACK_WORD],
        note: `Ollama correction failed: ${firstError}; retry failed: ${secondError}`,
        model: DEFAULT_OLLAMA_MODEL,
        status: unavailable ? 'unavailable' : 'error'
      };
    }
  }
}

async function requestOllamaCorrection(prompt: string): Promise<unknown>
{
  const response = await fetch(`${DEFAULT_OLLAMA_URL.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DEFAULT_OLLAMA_MODEL,
      stream: false,
      format: 'json',
      options: { temperature: 0 },
      messages: [
        {
          role: 'system',
          content: [
            'You convert noisy Korean jamo recognition into one meaningful Korean word.',
            'You may reorder jamo, drop extra jamo, merge duplicate jamo, and infer missing jamo.',
            'The final correctedWord must be exactly one common everyday Korean word between 1 and 4 Hangul syllables.',
            'Prefer words that most visitors immediately understand, such as emotions, objects, nature, relationships, and simple actions.',
            'Avoid proper nouns, place names, personal names, rare Sino-Korean words, technical terms, archaic words, and ambiguous obscure words.',
            'Return only valid JSON.'
          ].join(' ')
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok)
  {
    throw new Error(`Ollama HTTP ${response.status}`);
  }

  const data = await response.json() as { message?: { content?: unknown } };
  return parseJsonObject(String(data.message?.content ?? ''));
}

function buildCorrectionPrompt(rawJamo: string, composedText: string): string
{
  return `다음은 전시용 로봇손 5비트 자모 인식 결과입니다.

목표:
- rawJamo에 들어온 자모들을 재료로 보고, 가장 그럴듯한 1~4글자의 쉽고 일상적인 한국어 단어 하나를 고르세요.
- 입력 순서는 참고만 하세요. 필요하면 자모 순서를 바꾸거나, 일부 자모를 버리거나, 중복 자모를 합치거나, 빠진 자모를 조금 보완해도 됩니다.
- 단, 입력에 포함된 자모를 최대한 많이 설명할 수 있는 단어를 우선하세요.
- 전시 관객 대부분이 바로 이해할 수 있는 단어를 고르세요.
- 감정, 사물, 자연, 관계, 몸, 간단한 행동에 가까운 단어를 우선하세요.
- 지명, 인명, 고유명사, 전문용어, 옛말, 드문 한자어, 의미가 모호한 단어는 금지입니다.
- 예를 들어 "병천"처럼 실제 단어 또는 지명일 수 있어도 일상적 의미가 바로 떠오르지 않는 단어는 고르지 마세요.
- correctedWord는 반드시 완성형 한글 음절만 포함해야 합니다.
- 공백, 문장, 영어, 숫자, 낱자 자모, 한자, 일본어는 금지입니다.
- 입력 조각을 억지로 붙인 새 단어가 아니라 한국어 화자가 실제로 쓰는 단어여야 합니다.
- 좋은 예: rawJamo "ㅏㅐㅂㅂㅏㅇ"은 "방법" 또는 "방방"처럼 재배열해서 해석할 수 있습니다.
- 좋은 예: rawJamo "ㅅㅏㄹㅏㅇㅇ"은 "사랑"으로 해석할 수 있습니다.
- 좋은 예: rawJamo "ㅍㅕㅇㅎㅘㄱ"은 "평화"로 해석할 수 있습니다.

입력:
- rawJamo: ${rawJamo}
- composedText: ${composedText}

출력 JSON 형식:
{
  "correctedWord": "단어",
  "candidates": ["후보1", "후보2", "후보3"],
  "note": "짧은 근거"
}`;
}

function buildSemanticCheckPrompt(rawJamo: string, composedText: string, correction: ValidatedCorrection): string
{
  return `다음 보정 결과를 검수하세요.

검수 기준:
- correctedWord는 1~4글자의 쉽고 일상적인 한국어 단어여야 합니다.
- 전시 관객 대부분이 바로 이해할 수 있는 감정, 사물, 자연, 관계, 몸, 간단한 행동 관련 단어를 우선합니다.
- rawJamo의 순서는 바꿔도 되지만, 입력된 자모들과 형태/발음상 관련이 있어야 합니다.
- 의미가 불분명한 조합어, 영어, 낱자 자모, 문장, 공백 포함 결과는 실패입니다.
- 지명, 인명, 고유명사, 전문용어, 옛말, 드문 한자어, 의미가 모호한 단어는 실패입니다.
- "병천"처럼 관객이 보편적인 의미를 바로 이해하기 어려운 단어는 실패입니다.
- 실패라면 같은 rawJamo를 재배열/부분 사용해서 더 자연스러운 실제 한국어 단어로 교체하세요.
- JSON만 출력하세요.

입력:
- rawJamo: ${rawJamo}
- composedText: ${composedText}
- correctedWord: ${correction.correctedWord}
- candidates: ${correction.candidates.join(', ')}

출력 JSON 형식:
{
  "correctedWord": "단어",
  "candidates": ["후보1", "후보2", "후보3"],
  "note": "검수 결과"
}`;
}

function buildRepairPrompt(rawJamo: string, composedText: string, reason: string): string
{
  return `이전 응답이 규칙을 어겼습니다.

실패 이유:
${reason}

다시 출력하세요.
- correctedWord는 1~4글자의 쉽고 일상적인 한국어 단어 하나입니다.
- 감정, 사물, 자연, 관계, 몸, 간단한 행동 관련 단어를 우선하세요.
- 지명, 인명, 고유명사, 전문용어, 옛말, 드문 한자어, 의미가 모호한 단어는 금지입니다.
- rawJamo 순서 변경, 일부 삭제, 중복 병합을 허용합니다.
- 완성형 한글 음절만 허용합니다.
- JSON만 출력하세요.

입력:
- rawJamo: ${rawJamo}
- composedText: ${composedText}

출력 JSON 형식:
{
  "correctedWord": "단어",
  "candidates": ["후보1", "후보2", "후보3"],
  "note": "짧은 근거"
}`;
}

type ValidatedCorrection = {
  correctedWord: string;
  candidates: string[];
  note: string;
};

function validateCorrection(value: unknown): ValidatedCorrection
{
  if (typeof value !== 'object' || value === null)
  {
    throw new Error('LLM response must be an object');
  }

  const candidate = value as Partial<ValidatedCorrection>;
  const correctedWord = String(candidate.correctedWord ?? '').trim();
  const rawCandidates = Array.isArray(candidate.candidates) ? candidate.candidates : [correctedWord];
  const candidates = rawCandidates
    .map((entry) => String(entry).trim())
    .filter(isValidKoreanWord);

  if (!isValidKoreanWord(correctedWord))
  {
    const firstCandidate = candidates[0];
    if (firstCandidate === undefined)
    {
      throw new Error(`correctedWord is not a 1-4 syllable Korean word: ${correctedWord}`);
    }

    return {
      correctedWord: firstCandidate,
      candidates: [firstCandidate],
      note: String(candidate.note ?? '')
    };
  }

  return {
    correctedWord,
    candidates: [correctedWord],
    note: String(candidate.note ?? '')
  };
}

function parseJsonObject(text: string): unknown
{
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start)
  {
    throw new Error('JSON object not found');
  }

  return JSON.parse(trimmed.slice(start, end + 1));
}

function isValidKoreanWord(value: string): boolean
{
  return KOREAN_WORD_PATTERN.test(value.trim());
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
