import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CloudSentence, EMPTY_WORD_CLOUD, SentencePart, WordCloudState, sentenceText, sentenceWords } from '../shared/wordCloud.js';
import { isAllowedOutput } from './wordCorrection.js';

const MAX_WORDS = 50;
const MAX_SENTENCES = 80;
const part = (text: string, source = ''): SentencePart => ({ text, source });
function particle(word: string, closed: string, open: string): string
{
  return (word.charCodeAt(word.length - 1) - 0xac00) % 28 === 0 ? open : closed;
}

/** 모델은 모인 단어와 검토한 문장 틀을 고른다. 임의의 생성 문구를 전시장에 내보내지 않는다. */
export function composeCloudSentence(words: string[], template: number, origin: CloudSentence['origin']): CloudSentence
{
  const [a, b, c] = words;
  let parts: SentencePart[];
  switch (template)
  {
    case 1: parts = [part(a, a), part('의 곁에 '), part(b, b), part(`${particle(b, '이', '가')} 머문다.`)]; break;
    case 2: parts = [part(a, a), part(`${particle(a, '이', '가')} `), part(b, b), part(`${particle(b, '을', '를')} 천천히 깨운다.`)]; break;
    case 3: parts = [part(a, a), part('에서 '), part(b, b), part('까지, '), part(c, c), part(`${particle(c, '이', '가')} 이어진다.`)]; break;
    case 4: parts = [part(a, a), part(`${particle(a, '은', '는')} `), part(b, b), part(`${particle(b, '을', '를')} 지나 `), part(c, c), part('에 닿는다.')]; break;
    default: parts = [part(a, a), part(`${particle(a, '은', '는')} `), part(b, b), part(`${particle(b, '과', '와')} 만난다.`)];
  }
  const text = parts.map((piece) => piece.text).join('');
  return { id: createHash('sha256').update(text).digest('hex').slice(0, 16), parts, origin };
}

export function validateSentencePlan(value: unknown, words: string[]): CloudSentence | null
{
  const plan = value as { template?: unknown; words?: unknown } | null;
  if (!plan || !Number.isInteger(plan.template) || (plan.template as number) < 0 || (plan.template as number) > 4 || !Array.isArray(plan.words)) return null;
  const needed = (plan.template as number) >= 3 ? 3 : 2;
  if (plan.words.length !== needed || new Set(plan.words).size !== needed || plan.words.some((word) => typeof word !== 'string' || !words.includes(word))) return null;
  return composeCloudSentence(plan.words as string[], plan.template as number, 'model');
}

type Options = {
  file: string;
  onChange?: (state: WordCloudState) => void;
  generate?: (words: string[], latestWord: string, signal: AbortSignal) => Promise<CloudSentence | null>;
  debounceMs?: number;
};

export class WordCloud
{
  private state: WordCloudState = structuredClone(EMPTY_WORD_CLOUD);
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private revision = 0;

  constructor(private options: Options)
  {
    if (!fs.existsSync(options.file)) return;
    try
    {
      const saved = JSON.parse(fs.readFileSync(options.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.words) || !Array.isArray(saved.sentences)) throw new Error('잘못된 저장 형식');
      const words: string[] = [...new Set<string>(saved.words.filter((word: unknown) => typeof word === 'string' && isAllowedOutput(word)))].slice(-MAX_WORDS);
      // 파일을 읽을 때에도 저장된 임의 문구를 신뢰하지 않고 문장 틀로 재구성해 검사한다.
      const sentences: CloudSentence[] = [];
      for (const sentence of saved.sentences)
      {
        if (!Array.isArray(sentence?.parts) || !sentence.parts.every((piece: unknown) => piece && typeof (piece as SentencePart).text === 'string' && typeof (piece as SentencePart).source === 'string')) continue;
        const sources = sentenceWords(sentence);
        for (let template = 0; template <= 4; template++)
        {
          const rebuilt = validateSentencePlan({ words: sources, template }, words);
          if (rebuilt && sentenceText(rebuilt) === sentenceText(sentence))
          {
            rebuilt.origin = sentence.origin === 'model' ? 'model' : 'template';
            if (!sentences.some((entry) => entry.id === rebuilt.id)) sentences.push(rebuilt);
            break;
          }
        }
      }
      this.state = { ...this.state, words, latestWord: words.includes(saved.latestWord) ? saved.latestWord : words[words.length - 1] ?? '', sentences: sentences.slice(-MAX_SENTENCES) };
    }
    catch (error)
    {
      // 읽지 못한 기록을 덮어쓰지 않는다. 운영 화면에서 저장 오류를 알린다.
      this.state.storageAvailable = false;
      console.warn('단어 구름 기록을 읽지 못했습니다. 기존 파일은 보존합니다.', String(error));
    }
  }

  snapshot(): WordCloudState { return structuredClone(this.state); }

  addWord(word: string): void
  {
    if (!isAllowedOutput(word)) return;
    this.cancelGeneration();
    this.state.latestWord = word;
    if (!this.state.words.includes(word)) this.state.words.push(word);
    this.state.words = this.state.words.slice(-MAX_WORDS);
    this.state.sentences = this.state.sentences.filter((sentence) => sentenceWords(sentence).every((source) => this.state.words.includes(source)));
    const other = this.state.words.filter((entry) => entry !== word).slice(-1)[0];
    if (other) this.appendSentence(composeCloudSentence([word, other], this.state.words.length % 3, 'template'));
    this.publish(true);
    if (this.state.words.length >= 2 && this.options.generate)
    {
      this.timer = setTimeout(() => { this.timer = undefined; void this.enrich(); }, this.options.debounceMs ?? 700);
      this.timer.unref();
    }
  }

  removeWord(word: string): void
  {
    this.cancelGeneration();
    this.state.words = this.state.words.filter((entry) => entry !== word);
    this.state.sentences = this.state.sentences.filter((sentence) => !sentenceWords(sentence).includes(word));
    if (this.state.latestWord === word) this.state.latestWord = this.state.words[this.state.words.length - 1] ?? '';
    this.publish(true);
  }

  removeSentence(id: string): void
  {
    this.cancelGeneration();
    this.state.sentences = this.state.sentences.filter((sentence) => sentence.id !== id);
    this.publish(true);
  }

  cancelGeneration(): void
  {
    this.revision++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
    if (this.state.generating) { this.state.generating = false; this.publish(false); }
  }

  private appendSentence(sentence: CloudSentence): void
  {
    if (!this.state.sentences.some((entry) => entry.id === sentence.id)) this.state.sentences.push(sentence);
    this.state.sentences = this.state.sentences.slice(-MAX_SENTENCES);
  }

  private async enrich(): Promise<void>
  {
    const revision = this.revision;
    const controller = new AbortController();
    this.controller = controller;
    this.state.generating = true;
    this.publish(false);
    try
    {
      const sentence = await this.options.generate!([this.state.latestWord, ...this.state.words.filter((word) => word !== this.state.latestWord).slice(-11)], this.state.latestWord, controller.signal);
      if (revision !== this.revision || controller.signal.aborted) return;
      if (sentence && sentenceWords(sentence).every((word) => this.state.words.includes(word))) this.appendSentence(sentence);
    }
    catch { /* 즉시 준비한 문장 틀로 계속 전시한다. */ }
    finally
    {
      if (revision === this.revision)
      {
        this.controller = undefined;
        this.state.generating = false;
        this.publish(true);
      }
    }
  }

  private publish(save: boolean): void
  {
    if (save && this.state.storageAvailable)
    {
      try
      {
        fs.mkdirSync(path.dirname(this.options.file), { recursive: true });
        fs.writeFileSync(`${this.options.file}.tmp`, JSON.stringify({ version: 1, ...this.state, generating: false }), { mode: 0o600 });
        fs.renameSync(`${this.options.file}.tmp`, this.options.file);
      }
      catch (error) { this.state.storageAvailable = false; console.warn('단어 구름 기록 저장 실패:', String(error)); }
    }
    this.options.onChange?.(this.snapshot());
  }
}

export async function generateCloudSentence(words: string[], latestWord: string, signal: AbortSignal): Promise<CloudSentence | null>
{
  const response = await fetch(`${(process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '')}/api/chat`, {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct', stream: false, format: 'json', keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? '8h',
      messages: [{ role: 'user', content: `전시에 모인 단어: ${JSON.stringify(words)}. 최신 단어: ${latestWord}.
단어 중 서로 다른 2~3개와 아래 문장 틀 하나를 골라 시적인 한 문장을 만든다. 최신 단어를 우선 사용한다.
0: A는 B와 만난다. 1: A의 곁에 B가 머문다. 2: A가 B를 천천히 깨운다.
3: A에서 B까지, C가 이어진다. 4: A는 B를 지나 C에 닿는다.
틀 0~2는 단어 2개, 틀 3~4는 단어 3개. 문장을 쓰지 말고 {"template":0,"words":["목록의단어A","목록의단어B"]} 형식의 JSON만 출력한다.` }],
      options: { temperature: 0.7, num_predict: 90 }
    })
  });
  if (!response.ok) { await response.body?.cancel(); return null; }
  const body = await response.json() as { message?: { content?: string } };
  return validateSentencePlan(JSON.parse(body.message?.content ?? 'null'), words);
}
