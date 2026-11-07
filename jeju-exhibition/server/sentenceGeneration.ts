export type CloudSentence = {
  text: string;
  words: string[];
  parts: { text: string; source: string }[];
  model: string;
  elapsedMs: number;
};

const OLLAMA_URL = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
const SYSTEM_PROMPT = [
  'Write one short, natural Korean declarative sentence.',
  'Include EVERY supplied word verbatim, each in its own non-overlapping position.',
  'Use only Korean Hangul, spaces, commas and one final period. Never use Chinese characters or English.',
  'Use 15 to 90 characters and a complete predicate ending in 다. (including 합니다. or 습니다.), never 요. or a noun fragment.',
  'Connect the words with simple, meaningful everyday language. Avoid strained metaphors and invented expressions.',
  'Do not describe this exhibition, an art event, the audience, the generation process or yourself. No advertisements, invitations or commands.',
  'Return only JSON with one field: {"sentence":"한국어 문장."}.'
].join(' ');

function sentenceParts(text: string, words: string[]): CloudSentence['parts']
{
  const ordered = [...words].sort((left, right) => right.length - left.length);
  const ranges: { start: number; end: number; word: string }[] = [];

  // A short word inside a longer input word cannot animate from the same letters twice.
  const assign = (index: number): boolean =>
  {
    if (index === ordered.length) return true;
    const word = ordered[index];
    for (let start = text.indexOf(word); start !== -1; start = text.indexOf(word, start + 1))
    {
      const end = start + word.length;
      if (ranges.some((range) => start < range.end && end > range.start)) continue;
      ranges.push({ start, end, word });
      if (assign(index + 1)) return true;
      ranges.pop();
    }
    return false;
  };

  if (!assign(0))
  {
    throw new Error('입력 단어를 각각 별도의 위치에 한 번씩 포함해야 합니다. 긴 단어 안의 짧은 단어를 중복 사용하지 마세요.');
  }

  const parts: CloudSentence['parts'] = [];
  let cursor = 0;
  for (const range of ranges.sort((left, right) => left.start - right.start))
  {
    if (range.start > cursor) parts.push({ text: text.slice(cursor, range.start), source: '' });
    parts.push({ text: range.word, source: range.word });
    cursor = range.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), source: '' });
  return parts;
}

function validateSentence(raw: string, words: string[]): Pick<CloudSentence, 'text' | 'parts'>
{
  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { throw new Error('설명이나 코드 블록 없이 sentence 필드가 있는 JSON만 출력하세요.'); }
  if (typeof payload !== 'object' || payload === null || !('sentence' in payload) || typeof payload.sentence !== 'string')
  {
    throw new Error('JSON의 sentence 필드에 한국어 문장 하나를 넣으세요.');
  }

  const text = payload.sentence.trim();
  if (text.length < 15 || text.length > 90 || !/^[가-힣 ,]+\.$/.test(text))
  {
    throw new Error('한글, 띄어쓰기, 쉼표만 사용한 15~90자의 문장 하나를 마침표로 끝내세요.');
  }
  // This rejects obvious noun fragments; it does not claim to prove semantic quality.
  if (!/다\.$/.test(text))
  {
    throw new Error('명사로 끝나는 구절이나 초대 문구가 아닌, 서술어를 갖춘 평서문을 다.로 끝내세요. 요.체는 사용하지 마세요.');
  }
  const missing = words.filter((word) => !text.includes(word));
  if (missing.length) throw new Error(`빠진 입력 단어를 원형 그대로 포함하세요: ${missing.join(', ')}`);
  return { text, parts: sentenceParts(text, words) };
}

async function requestSentence(words: string[], previous: string, problem: string): Promise<string>
{
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `반드시 포함할 단어: ${words.join(', ')}. 모든 단어를 자연스럽게 연결한 한국어 한 문장을 써 주세요.` }
  ];
  if (problem)
  {
    messages.push({ role: 'assistant', content: previous });
    messages.push({ role: 'user', content: `이전 답변을 수정하세요. ${problem} 입력 단어: ${words.join(', ')}.` });
  }

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
        options: { temperature: 0.2, num_predict: 240 },
        messages
      })
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const responseBody = await response.json() as { message?: { content?: unknown } };
    return typeof responseBody.message?.content === 'string' ? responseBody.message.content : '';
  }
  finally { clearTimeout(timer); }
}

export async function generateSentence(words: string[]): Promise<CloudSentence>
{
  if (!Array.isArray(words) || words.length < 2 || words.length > 4 ||
      words.some((word) => typeof word !== 'string' || !/^[가-힣]{1,4}$/.test(word)) ||
      new Set(words).size !== words.length)
  {
    throw new Error('문장에는 서로 다른 한글 단어 2~4개가 필요합니다.');
  }

  const inputWords = [...words];
  const startedAt = Date.now();
  let previous = '';
  let problem = '';
  for (let attempt = 0; attempt < 2; attempt += 1)
  {
    // Network failures propagate immediately; only invalid model output gets one retry.
    previous = await requestSentence(inputWords, previous, problem);
    try
    {
      const sentence = validateSentence(previous, inputWords);
      return { ...sentence, words: inputWords, model: OLLAMA_MODEL, elapsedMs: Date.now() - startedAt };
    }
    catch (error)
    {
      problem = error instanceof Error ? error.message : String(error);
      if (attempt === 1) throw new Error(`문장 검증 실패: ${problem}`);
    }
  }
  throw new Error('문장을 만들지 못했습니다.');
}
