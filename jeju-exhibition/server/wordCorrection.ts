import { composeJamo, decomposeWord, isValidKoreanWord } from './hangul.js';
import { VOCABULARY } from './vocabulary.js';

/** 슬롯 하나 = 관객이 만든 손 모양 하나. 그 모양이 될 수 있는 자모 후보들을 담는다 */
export type JamoSlot = {
  classId: string;
  candidates: string[];
};

export type WordCorrection = {
  slots: JamoSlot[];
  /** 각 슬롯의 후보를 모두 이어붙인 표시용 문자열. 예: "[ㄱㄴㅏㅗㅜㅡ][ㅁ]..." */
  slotSummary: string;
  /** LLM 또는 대체 경로가 실제로 고른 자모열 */
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

const OLLAMA_URL = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';

/**
 * ACC 버전은 fetch에 타임아웃이 없어서 Ollama가 연결만 받고 멈추면 전시 화면이
 * 무한정 정지한다(binaryJamo.ts:294). 여기서는 반드시 상한을 둔다.
 *
 * 값이 20초인 이유: 실측상 모델이 메모리에 올라간 뒤에는 7초 안팎이지만,
 * 콜드 로드가 걸린 첫 호출은 12초를 넘겼다. 예열(warmUpOllama)을 하더라도
 * 전시 중 모델이 언로드될 수 있으므로 여유를 둔다.
 */
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 20000);

// ---------------------------------------------------------------------------
// 결정론적 대체 경로: 후보 자모로 덮을 수 있는 단어를 단어장에서 찾는다
// ---------------------------------------------------------------------------

/**
 * 슬롯당 자모 하나씩만 쓸 수 있다는 제약 아래, 단어의 자모를 슬롯에 최대한 배정한다.
 * 슬롯 6개 x 자모 12개 규모라 단순 증가경로 이분매칭으로 충분하다.
 *
 * @returns 슬롯에 배정된 자모 개수
 */
function matchCount(wordJamo: string[], slots: JamoSlot[]): number
{
  const slotTaken: (number | null)[] = slots.map(() => null);

  const tryAssign = (jamoIndex: number, visited: boolean[]): boolean =>
  {
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1)
    {
      if (visited[slotIndex] || !slots[slotIndex].candidates.includes(wordJamo[jamoIndex]))
      {
        continue;
      }

      visited[slotIndex] = true;
      const holder = slotTaken[slotIndex];

      if (holder === null || tryAssign(holder, visited))
      {
        slotTaken[slotIndex] = jamoIndex;
        return true;
      }
    }

    return false;
  };

  let matched = 0;
  for (let jamoIndex = 0; jamoIndex < wordJamo.length; jamoIndex += 1)
  {
    if (tryAssign(jamoIndex, slots.map(() => false)))
    {
      matched += 1;
    }
  }

  return matched;
}

export type VocabularyMatch = {
  word: string;
  /** 단어의 자모 중 슬롯으로 설명되는 비율 */
  coverage: number;
  /** 실제로 쓰인 슬롯 개수. 관객의 입력을 얼마나 많이 반영했는지를 뜻한다 */
  matched: number;
  /** matched x coverage. 아래 설명 참고 */
  score: number;
  jamo: string[];
};

/**
 * 후보 자모로 가장 잘 설명되는 단어들을 단어장에서 고른다.
 *
 * 점수를 matched x coverage 로 잡은 이유가 이 함수의 핵심이다.
 *
 * 덮인 비율만 보면 짧은 단어가 항상 이긴다. `길`(ㄱㅣㄹ)은 100% 덮이지만 손 모양
 * 여섯 개 중 세 개만 쓴다. 반대로 쓰인 슬롯 수만 보면 자모가 거의 설명되지 않는
 * 긴 단어가 이긴다. 이 작품은 흩어진 개인의 입력이 하나로 합쳐지는 것을 보여주는
 * 것이므로 둘 다 필요하다. 곱하면 이렇게 갈린다.
 *
 *   길   자모 3개, 3개 사용, 100%  ->  3 x 1.00 = 3.00
 *   사랑 자모 5개, 4개 사용,  80%  ->  4 x 0.80 = 3.20   <- 이쪽을 고른다
 *   비   자모 2개, 2개 사용, 100%  ->  2 x 1.00 = 2.00
 *
 * 슬롯 여섯 개를 모두 쓰면서 자모도 전부 설명되는 단어가 최고점(6.0)을 받는다.
 */
export function matchVocabulary(slots: JamoSlot[], limit = 5): VocabularyMatch[]
{
  return VOCABULARY
    .map((word) =>
    {
      const jamo = decomposeWord(word);
      const matched = matchCount(jamo, slots);
      const coverage = matched / jamo.length;
      return { word, jamo, matched, coverage, score: matched * coverage };
    })
    .sort((left, right) =>
    {
      if (right.score !== left.score)
      {
        return right.score - left.score;
      }
      return right.coverage - left.coverage;
    })
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// LLM 경로
// ---------------------------------------------------------------------------

function describeSlots(slots: JamoSlot[]): string
{
  return slots
    .map((slot, index) => `  ${index + 1}번 손모양: ${slot.candidates.join(' 또는 ')}`)
    .join('\n');
}

function summarizeSlots(slots: JamoSlot[]): string
{
  return slots.map((slot) => `[${slot.candidates.join('')}]`).join('');
}

/**
 * 프롬프트와 출력을 둘 다 짧게 유지한다.
 *
 * 실측(전시 화면이 렌더링 중인 상태): 입력 625토큰에 2.6~4.0초, 출력 67토큰에 7.6초.
 * 생성이 초당 9토큰밖에 안 나오는 것은 WebGL 화면이 GPU를 함께 쓰기 때문이다.
 * 그래서 출력 토큰 하나가 비싸다. 화면에 나가지 않는 note와 candidates를 LLM에게
 * 시키면 그것만으로 5초가 더 든다. 둘 다 서버에서 만든다.
 */
function buildPrompt(slots: JamoSlot[], shortlist: VocabularyMatch[]): string
{
  const options = shortlist
    .map((entry) => `${entry.word}(${entry.matched}개)`)
    .join(' ');

  return `손 모양 ${slots.length}개다. 손목을 못 움직여서 각 손 모양은 아래 자모 중 하나일 수 있다.

${describeSlots(slots)}

후보 단어 (괄호는 쓰는 손 모양 수):
${options}

후보 중 하나를 고르되, 손 모양을 많이 쓰면서 뜻이 통하는 것을 우선하라.
모두 어색하면 위 자모로 설명되는 다른 실제 한국어 일상 단어를 써도 된다. 단어를 지어내지 마라.
1~4글자 완성형 한글만. 지명·인명·고유명사·전문용어 금지.

JSON만 출력:
{"correctedWord":"단어","chosenJamo":["자","모"]}`;
}

/**
 * LLM이 목록 밖 단어를 제안했을 때 그것이 실재하는 일상 단어인지 한 번 더 묻는다.
 *
 * 필요한 이유: 완성형 한글 1~4글자라는 정규식만으로는 `습수`, `섭시` 같은 비단어가
 * 그대로 통과한다. ACC 버전이 `병천`으로 겪었던 것과 같은 실패다.
 * 목록 안에서 고른 경우에는 이 호출을 건너뛰므로 평상시 지연은 늘지 않는다.
 */
function buildRealWordCheckPrompt(word: string): string
{
  return `"${word}"가 한국어에서 실제로 쓰이는 일상적인 단어인가?
자모를 억지로 이어 붙인 비단어, 지명, 인명, 전문용어, 옛말은 false다.

JSON만 출력: {"isRealWord":true 또는 false}`;
}

const SYSTEM_PROMPT = [
  'You interpret ambiguous Korean fingerspelling into one meaningful Korean word.',
  'Each hand shape maps to several possible jamo because the exhibition hand cannot rotate its wrist.',
  'Pick one jamo per hand shape and produce a single everyday Korean word of 1 to 4 Hangul syllables.',
  'Prefer words about emotion, nature, objects, relationships, the body, and simple actions.',
  'Avoid proper nouns, place names, personal names, rare Sino-Korean words, technical terms and archaic words.',
  'Return only valid JSON.'
].join(' ');

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

type LlmPayload = {
  correctedWord: string;
  chosenJamo: string[];
};

/** LLM에게는 correctedWord와 chosenJamo만 시킨다. 나머지는 서버가 만든다 */
function validatePayload(value: unknown, slots: JamoSlot[]): LlmPayload
{
  if (typeof value !== 'object' || value === null)
  {
    throw new Error('LLM response must be an object');
  }

  const raw = value as Partial<LlmPayload>;
  const correctedWord = String(raw.correctedWord ?? '').trim();

  if (!isValidKoreanWord(correctedWord))
  {
    throw new Error(`correctedWord is not a 1-4 syllable Korean word: ${correctedWord}`);
  }

  const allowed = new Set(slots.flatMap((slot) => slot.candidates));
  const reported = (Array.isArray(raw.chosenJamo) ? raw.chosenJamo : [])
    .map((entry) => String(entry).trim())
    .filter((entry) => allowed.has(entry));

  // LLM이 단어와 어긋나는 자모를 돌려주는 일이 잦다.
  // 실측 예: correctedWord "인사"에 chosenJamo ["ㅇ","ㅣ","ㄴ"] (ㅅㅏ 누락).
  // 화면에는 자모와 단어가 나란히 나가므로 둘이 맞지 않으면 관객이 바로 알아본다.
  // 자모열이 단어로 되조합되지 않으면 단어에서 역산한 것을 쓴다.
  const chosenJamo = reported.length > 0 && composeJamo(reported) === correctedWord
    ? reported
    : decomposeWord(correctedWord);

  return { correctedWord, chosenJamo };
}

async function requestOllama(prompt: string): Promise<unknown>
{
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try
  {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json',
        // 전시 중 모델이 언로드되어 다음 관객이 콜드 로드를 맞지 않게 한다
        keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? '8h',
        options: {
          temperature: 0.2,
          // 출력은 짧은 JSON 하나뿐이다. 상한을 두지 않으면 모델이 note를 길게 늘여
          // 응답이 15초를 넘기고, 전시 화면은 그동안 "찾는 중"에 멈춰 있다.
          num_predict: 160
        },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
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
  finally
  {
    clearTimeout(timer);
  }
}

/**
 * 모델을 메모리에 미리 올린다.
 *
 * 예열하지 않으면 전시장의 첫 관객이 만든 단어는 거의 확실히 대체 경로로 떨어진다.
 * 실측: 콜드 호출 12초 초과, 예열 후 호출 약 7초.
 * keep_alive를 길게 잡아 전시 시간 동안 모델이 내려가지 않게 한다.
 */
export async function warmUpOllama(): Promise<{ ok: boolean; elapsedMs: number; detail: string }>
{
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try
  {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json',
        keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? '8h',
        options: { temperature: 0, num_predict: 8 },
        messages: [
          { role: 'system', content: 'Return only valid JSON.' },
          { role: 'user', content: '{"ping":true} 를 그대로 돌려줘' }
        ]
      })
    });

    return {
      ok: response.ok,
      elapsedMs: Date.now() - startedAt,
      detail: response.ok ? `${OLLAMA_MODEL} 예열 완료` : `Ollama HTTP ${response.status}`
    };
  }
  catch (error)
  {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      detail: `예열 실패, 단어장 대체 경로로 운영된다: ${error}`
    };
  }
  finally
  {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------

/**
 * 후보 자모 슬롯들로부터 단어 하나를 만든다.
 *
 * Ollama가 먼저이고, 실패하면 단어장 대체 경로로 넘어간다. 대체 경로는 네트워크를
 * 타지 않으므로 전시 중 LLM이 죽어도 화면은 계속 단어를 낸다.
 */
export async function correctWord(slots: JamoSlot[]): Promise<WordCorrection>
{
  const startedAt = Date.now();
  const slotSummary = summarizeSlots(slots);
  // 프롬프트에 넣는 후보 수. 12개로 두었더니 전시 화면이 렌더링 중일 때
  // 응답이 일관되게 15초가 나왔다. 6개로 줄여도 고를 여지는 충분하다.
  const vocabularyMatches = matchVocabulary(slots, 6);

  const finish = (
    partial: Pick<WordCorrection, 'chosenJamo' | 'correctedWord' | 'candidates' | 'note' | 'source' | 'status'>
  ): WordCorrection => ({
    slots,
    slotSummary,
    composedText: composeJamo(partial.chosenJamo),
    model: OLLAMA_MODEL,
    elapsedMs: Date.now() - startedAt,
    ...partial
  });

  try
  {
    const payload = validatePayload(await requestOllama(buildPrompt(slots, vocabularyMatches)), slots);
    const onShortlist = vocabularyMatches.some((entry) => entry.word === payload.correctedWord);
    const inVocabulary = onShortlist || VOCABULARY.includes(payload.correctedWord);

    if (!inVocabulary)
    {
      const verdict = await requestOllama(buildRealWordCheckPrompt(payload.correctedWord)) as { isRealWord?: unknown };

      if (verdict?.isRealWord !== true)
      {
        const best = vocabularyMatches[0];
        if (best !== undefined)
        {
          return finish({
            chosenJamo: best.jamo,
            correctedWord: best.word,
            candidates: vocabularyMatches.map((entry) => entry.word),
            note: `LLM이 제안한 "${payload.correctedWord}"가 실재 단어 검사를 통과하지 못해 단어장에서 골랐다`,
            source: 'vocabulary',
            status: 'ok'
          });
        }
      }
    }

    const usedSlots = new Set(payload.chosenJamo).size;

    return finish({
      chosenJamo: payload.chosenJamo,
      correctedWord: payload.correctedWord,
      candidates: [payload.correctedWord, ...vocabularyMatches
        .map((entry) => entry.word)
        .filter((word) => word !== payload.correctedWord)
        .slice(0, 4)],
      // note는 LLM에게 시키지 않는다. 출력 토큰 하나가 비싸고 화면에 나가지도 않는다
      note: onShortlist
        ? `단어장 후보에서 골랐다 (자모 ${usedSlots}개 사용)`
        : '목록 밖 단어를 제안했고 실재 단어 검사를 통과했다',
      source: 'llm',
      status: 'ok'
    });
  }
  catch (error)
  {
    const best = vocabularyMatches[0];
    const aborted = error instanceof Error && error.name === 'AbortError';
    const unreachable = aborted || String(error).includes('ECONNREFUSED') || error instanceof TypeError;

    if (best === undefined)
    {
      return finish({
        chosenJamo: [],
        correctedWord: '',
        candidates: [],
        note: `LLM 실패, 단어장에서도 후보를 찾지 못했다: ${error}`,
        source: 'none',
        status: unreachable ? 'unavailable' : 'error'
      });
    }

    return finish({
      chosenJamo: best.jamo,
      correctedWord: best.word,
      candidates: vocabularyMatches.map((entry) => entry.word),
      note: aborted
        ? `Ollama 응답이 ${OLLAMA_TIMEOUT_MS}ms를 넘겨 단어장으로 대체했다 (손 모양 ${best.matched}개 사용, 덮인 비율 ${Math.round(best.coverage * 100)}%)`
        : `LLM 실패로 단어장으로 대체했다 (손 모양 ${best.matched}개 사용, 덮인 비율 ${Math.round(best.coverage * 100)}%): ${error}`,
      source: 'vocabulary',
      status: unreachable ? 'unavailable' : 'error'
    });
  }
}
