import { createHash } from 'node:crypto';
import { CloudSentence, SentencePart } from '../shared/wordCloud.js';
import { EXHIBITION_THEME } from '../shared/exhibitionTheme.js';
import { hasBlockedWords } from './wordCorrection.js';

const part = (text: string, source = ''): SentencePart => ({ text, source });
function particle(word: string, closed: string, open: string): string
{
  return (word.charCodeAt(word.length - 1) - 0xac00) % 28 === 0 ? open : closed;
}

function sentence(parts: SentencePart[], origin: CloudSentence['origin']): CloudSentence
{
  const text = parts.map((piece) => piece.text).join('');
  return { id: createHash('sha256').update(text).digest('hex').slice(0, 16), parts, origin };
}

/** 검토 실패 시에도 같은 두 단어를 공동 표현의 소재로 삼는다. AI 검토 문장과 구분해 표시한다. */
export function createFallbackSentence(words: string[]): CloudSentence
{
  const [a, b] = words;
  return sentence([
    part('우리는 ‘'), part(a, a), part(`’${particle(a, '과', '와')} ‘`), part(b, b),
    part(`’${particle(b, '을', '를')} 저마다의 방식으로 표현하며 한 장면을 함께 채웠다.`)
  ], 'template');
}

/** 실제 단어 노드와 문장 안의 위치를 연결한다. 같은 단어의 중복 사용은 애니메이션을 깨므로 거부한다. */
export function validateModelSentence(value: unknown, knownWords: string[]): CloudSentence | null
{
  const candidate = value as { text?: unknown; words?: unknown } | null;
  if (!candidate || typeof candidate.text !== 'string' || !Array.isArray(candidate.words)) return null;
  const text = candidate.text.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (text.length < 12 || text.length > 70 || !/^[가-힣 ,.'‘’“”·…-]+$/u.test(text) ||
      !text.endsWith('다.') || (text.match(/\./g)?.length ?? 0) !== 1 || hasBlockedWords(text)) return null;
  const words = candidate.words;
  if (words.length < 2 || words.length > 3 || new Set(words).size !== words.length ||
      words.some((word) => typeof word !== 'string' || !knownWords.includes(word))) return null;
  const ordered = (words as string[]).slice().sort((a, b) => b.length - a.length);
  const found = new Set<string>();
  const parts: SentencePart[] = [];
  let filler = '';
  for (let index = 0; index < text.length;)
  {
    const word = ordered.find((entry) => text.startsWith(entry, index));
    if (word)
    {
      if (found.has(word)) return null;
      if (filler) parts.push(part(filler));
      filler = '';
      parts.push(part(word, word));
      found.add(word);
      index += word.length;
    }
    else filler += text[index++];
  }
  if (filler) parts.push(part(filler));
  return found.size === words.length ? sentence(parts, 'model') : null;
}

export function parseSentenceCandidates(value: unknown, words: string[]): CloudSentence[]
{
  if (words.length !== 2 || new Set(words).size !== 2) return [];
  const candidates = (value as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(candidates) || candidates.length > 2) return [];
  // 선택한 단어는 서버가 알고 있으므로 작성 응답에서 다시 받아 대조할 필요가 없다.
  const valid = candidates.map((text) =>
  {
    // 완결 어미 뒤의 마침표를 생략한 모델 응답에도 문장부호만 보완한다.
    const trimmed = typeof text === 'string' ? text.trim() : text;
    const punctuated = typeof trimmed === 'string' && trimmed.endsWith('다') ? trimmed + '.' : trimmed;
    return validateModelSentence({ text: punctuated, words }, words);
  }).filter((entry): entry is CloudSentence => entry !== null);
  return valid.filter((entry, index) => valid.findIndex((other) => entry.id === other.id) === index);
}

export function selectReviewedSentence(value: unknown, candidates: CloudSentence[]): CloudSentence | null
{
  const review = value as { best?: unknown; natural?: unknown; coherent?: unknown; usesWords?: unknown; themeAligned?: unknown; respectful?: unknown; themeEvidence?: unknown } | null;
  if (!review || !Number.isInteger(review.best) || review.natural !== true || review.coherent !== true ||
      review.usesWords !== true || review.themeAligned !== true || review.respectful !== true) return null;
  const candidate = candidates[review.best as number];
  if (!candidate || typeof review.themeEvidence !== 'string') return null;
  const evidence = review.themeEvidence.normalize('NFC').trim().replace(/\s+/g, ' ');
  const text = candidate.parts.map((piece) => piece.text).join('');
  // 판정만 true로 내놓거나 다른 후보의 근거를 인용한 응답은 전시하지 않는다.
  if (evidence.length < 8 || evidence.length > 70 || !text.includes(evidence) ||
      !/서로|각자|저마다|한 사람|다른 사람|두 사람|다른 이|한 명|각기/u.test(evidence)) return null;
  return candidate;
}

async function requestModel(prompt: string, signal: AbortSignal, numPredict: number, temperature: number, format: Record<string, unknown>): Promise<unknown>
{
  const response = await fetch(`${(process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '')}/api/chat`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct', stream: false, think: false, format, keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? '8h',
      messages: [{ role: 'user', content: prompt }], options: { temperature, num_predict: numPredict }
    })
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`문장 모델 응답 실패 (${response.status})`); }
  const body = await response.json() as { message?: { content?: string } };
  return JSON.parse(body.message?.content ?? 'null');
}

/** 단어 선택은 호출자가 끝낸다. 모델은 고정된 두 단어로 문장만 작성한다. */
export async function generateCloudSentence(words: string[], signal: AbortSignal, options: { timeoutMs?: number; avoidSentences?: string[] } = {}): Promise<CloudSentence | null>
{
  if (words.length !== 2 || new Set(words).size !== 2) return null;
  const timeout = options.timeoutMs ?? Number(process.env.SENTENCE_DEADLINE_MS ?? 18000);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('SENTENCE_DEADLINE_MS는 양수여야 합니다.');
  // 작성과 검토가 각각 시간을 새로 받지 않고 하나의 데드라인을 공유한다.
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
  const avoidSentences = options.avoidSentences ?? [];
  const writerSchema = {
    type: 'object', properties: { candidates: {
      type: 'array', minItems: 2, maxItems: 2, items: { type: 'string', maxLength: 70 }
    } }, required: ['candidates'], additionalProperties: false
  };
  const candidates = parseSentenceCandidates(await requestModel(`제주 ${EXHIBITION_THEME.event} 전시 문장을 쓴다.
각 문장은 두 관객이 하나의 작품을 함께 만드는 짧은 장면이다. 한 사람이 첫 소재를 표현하고, 다른 사람이 둘째 소재를 다른 방법으로 보탠다. 사람의 행동을 구체적으로 쓴다.
출력 예시. 입력 ["바람","온기"]
{"candidates":["한 사람은 바람을 종이에 선으로 그리고 다른 사람은 온기를 그 위에 색으로 더했다.","온기를 색종이로 붙인 사람 곁에서 다른 이는 바람을 천의 움직임으로 표현했다."]}
실제 입력 ${JSON.stringify(words)}. 각 문장에 이 두 단어만 필수 단어로 삼아 원형 그대로 한 번씩 넣는다.
예시와 다른 행동과 작품을 쓴다. 사물을 사람처럼 행동하게 하지 않는다. 동정, 극복, 구호는 피한다.
문장마다 주어가 다른 두 관객의 역할을 보여 준다. '한 사람은'과 '다른 사람은'처럼 구분해도 좋다. 한 항목에 짧은 과거형 문장 하나만 쓴다.
반복 금지 ${JSON.stringify(avoidSentences.slice(-4))}
JSON의 candidates에 문장 문자열 두 개만 넣는다.`, bounded, 160, 0.45, writerSchema), words).filter((candidate) => !avoidSentences.includes(candidate.parts.map((piece) => piece.text).join('')));
  if (!candidates.length) return null;
  const reviewSchema = { type: 'object', properties: {
    best: { type: 'integer', enum: [-1, ...candidates.map((_, index) => index)] },
    natural: { type: 'boolean' }, coherent: { type: 'boolean' }, usesWords: { type: 'boolean' },
    themeAligned: { type: 'boolean' }, respectful: { type: 'boolean' }, themeEvidence: { type: 'string', maxLength: 70 }
  }, required: ['best', 'natural', 'coherent', 'usesWords', 'themeAligned', 'respectful', 'themeEvidence'], additionalProperties: false };
  const review = await requestModel(`한국어 문장 편집자다. 필수 단어 ${JSON.stringify(words)}.
후보 배열 ${JSON.stringify(candidates.map((entry) => entry.parts.map((piece) => piece.text).join('')))}
문장 자체에서 다섯 항목을 판단한다.
natural: 문법과 표현이 자연스럽다.
coherent: 장면과 두 단어의 연결을 이해할 수 있다. 근거 없는 의인화나 억지 인과는 탈락이다.
usesWords: 두 단어를 실제 의미나 작품의 소재로 썼다.
themeAligned: 두 사람이 각각 한 구체적 표현을 같은 작품에 보탠다. 한 사람의 감상이나 사물이 행동하는 장면은 탈락이다.
respectful: 각자가 표현의 주체다. 동정·극복·일방적 시혜가 없다.
다섯 항목이 모두 참인 후보의 배열 번호를 best에 넣는다. 첫 문장은 0, 둘째 문장은 1이다. themeEvidence에는 그 문장에서 '서로', '각자', '한 사람', '다른 사람' 같은 참여 주체와 행동을 함께 보여 주는 구절을 원문 그대로 복사한다. 적합한 후보가 없으면 best는 -1, themeEvidence는 빈 문자열이다. 판정은 JSON boolean으로 쓴다.`, bounded, 130, 0, reviewSchema);
  return selectReviewedSentence(review, candidates);
}
