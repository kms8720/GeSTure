import fs from 'node:fs';
import path from 'node:path';
import { CloudSentence, EMPTY_WORD_CLOUD, WordCloudState, sentenceText, sentenceWords } from '../shared/wordCloud.js';
import { isAllowedOutput } from './wordCorrection.js';
import { createNeutralSentence, validateModelSentence } from './sentenceComposition.js';
import { EXHIBITION_THEME } from '../shared/exhibitionTheme.js';
export { generateCloudSentence } from './sentenceComposition.js';

const MAX_WORDS = 50;
const MAX_SENTENCES = 80;

type Options = {
  file: string;
  onChange?: (state: WordCloudState) => void;
  generate?: (words: string[], signal: AbortSignal, options: { avoidSentences: string[] }) => Promise<CloudSentence | null>;
  debounceMs?: number;
  random?: () => number;
  autoGenerateMs?: number;
};

/** 새 입력은 반드시 포함하고, 나머지는 전체 기록에서 중복 없이 같은 확률로 뽑는다. */
export function chooseSentenceWords(words: string[], requiredWord?: string, random = Math.random): string[]
{
  const pool = [...new Set(words)];
  if (pool.length < 2) return [];
  const picked: string[] = [];
  if (requiredWord && pool.includes(requiredWord)) picked.push(...pool.splice(pool.indexOf(requiredWord), 1));
  while (picked.length < 2) picked.push(...pool.splice(Math.floor(random() * pool.length), 1));
  return picked;
}

export class WordCloud
{
  private state: WordCloudState = structuredClone(EMPTY_WORD_CLOUD);
  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private revision = 0;
  private autoTimer?: ReturnType<typeof setInterval>;
  private lastFinishedAt = 0;
  private pairPool: string[][] = [];
  private pairPoolWords = '';
  private lastPair = '';
  private removedTexts = new Set<string>();

  constructor(private options: Options)
  {
    if (!fs.existsSync(options.file)) return;
    try
    {
      const saved = JSON.parse(fs.readFileSync(options.file, 'utf8'));
      if (![1, 2].includes(saved.version) || !Array.isArray(saved.words) || !Array.isArray(saved.sentences)) throw new Error('잘못된 저장 형식');
      const words: string[] = [...new Set<string>(saved.words.filter((word: unknown) => typeof word === 'string' && isAllowedOutput(word)))].slice(-MAX_WORDS);
      this.state = { ...this.state, words, latestWord: words.includes(saved.latestWord) ? saved.latestWord : words[words.length - 1] ?? '' };
      this.state.sentenceRevision = Number.isSafeInteger(saved.sentenceRevision) && saved.sentenceRevision >= 0 ? saved.sentenceRevision : 0;
      const sentences: CloudSentence[] = [];
      if (saved.version === 1)
      {
        this.ensureNeutralSentence();
        // 기존 고정 틀 문장은 따로 보존하고 전시 후보에서는 제외한다. 단어 기록은 이어 간다.
        const backup = `${options.file}.v1-backup`;
        if (!fs.existsSync(backup)) fs.copyFileSync(options.file, backup, fs.constants.COPYFILE_EXCL);
      }
      else if (saved.sentenceTheme !== EXHIBITION_THEME.id)
      {
        // 주제 검토를 거치지 않은 이전 문장은 보관만 하고 새 전시에서는 재생하지 않는다.
        this.ensureNeutralSentence();
        const backup = `${options.file}.before-${EXHIBITION_THEME.id}`;
        if (!fs.existsSync(backup)) fs.copyFileSync(options.file, backup, fs.constants.COPYFILE_EXCL);
      }
      else
      {
        for (const entry of saved.sentences)
        {
          if (!Array.isArray(entry?.parts) || !entry.parts.every((piece: unknown) => piece && typeof (piece as { text?: unknown }).text === 'string' && typeof (piece as { source?: unknown }).source === 'string')) continue;
          const rebuilt = validateModelSentence({ text: sentenceText(entry), words: sentenceWords(entry) }, words);
          if (!rebuilt) continue;
          if (entry.origin === 'template')
          {
            const neutral = createNeutralSentence(sentenceWords(rebuilt));
            if (sentenceText(neutral) !== sentenceText(rebuilt)) continue;
            rebuilt.origin = 'template';
          }
          if (!sentences.some((sentence) => sentence.id === rebuilt.id)) sentences.push(rebuilt);
        }
      }
      if (saved.version === 2 && saved.sentenceTheme === EXHIBITION_THEME.id) this.state.sentences = sentences.slice(-MAX_SENTENCES);
      const latest = this.state.sentences[this.state.sentences.length - 1];
      if (latest) this.lastPair = this.pairKey(sentenceWords(latest));
    }
    catch (error)
    {
      this.state.storageAvailable = false;
      console.warn('단어 구름 기록을 읽지 못했습니다. 기존 파일은 보존합니다.', String(error));
    }
  }

  snapshot(): WordCloudState { return structuredClone(this.state); }

  /** 서버 한 곳에서만 돌린다. 화면 수와 무관하며 관객의 단어 생성 중에는 시작하지 않는다. */
  startAutoGeneration(ready = () => true): void
  {
    if (this.autoTimer) return;
    const interval = this.options.autoGenerateMs ?? 10_000;
    if (!Number.isFinite(interval) || interval <= 0) throw new Error('문장 자동 생성 간격은 양수여야 합니다.');
    const advance = () =>
    {
      if (!ready() || this.timer || this.controller || this.state.words.length < 2 || !this.options.generate ||
          Date.now() - this.lastFinishedAt < interval) return;
      void this.regenerate(true);
    };
    this.autoTimer = setInterval(advance, Math.min(interval, 1000));
    this.autoTimer.unref();
    advance();
  }

  stopAutoGeneration(): void
  {
    clearInterval(this.autoTimer);
    this.autoTimer = undefined;
  }

  private pairKey(words: string[]): string { return words.slice().sort().join('|'); }

  private nextAutomaticPair(): string[]
  {
    const signature = this.state.words.join('|');
    if (signature !== this.pairPoolWords || !this.pairPool.length)
    {
      this.pairPoolWords = signature;
      this.pairPool = this.state.words.flatMap((word, index) => this.state.words.slice(index + 1).map((other) => [word, other]));
    }
    // 한 바퀴 동안 같은 조합을 다시 뽑지 않고, 경계에서도 직전 조합을 피한다.
    const alternatives = this.pairPool.filter((words) => this.pairKey(words) !== this.lastPair);
    const choices = alternatives.length ? alternatives : this.pairPool;
    const chosen = choices[Math.floor((this.options.random ?? Math.random)() * choices.length)];
    this.pairPool.splice(this.pairPool.indexOf(chosen), 1);
    return chosen;
  }

  addWord(word: string): void
  {
    if (!isAllowedOutput(word)) return;
    this.cancelGeneration();
    this.state.latestWord = word;
    if (!this.state.words.includes(word)) this.state.words.push(word);
    this.state.words = this.state.words.slice(-MAX_WORDS);
    this.state.sentences = this.state.sentences.filter((sentence) => sentenceWords(sentence).every((source) => this.state.words.includes(source)));
    const words = chooseSentenceWords(this.state.words, word, this.options.random);
    this.ensureNeutralSentence(words);
    this.publish(true);
    if (this.state.words.length >= 2 && this.options.generate)
    {
      this.timer = setTimeout(() => { this.timer = undefined; void this.enrich(words); }, this.options.debounceMs ?? 700);
      this.timer.unref();
    }
  }

  async regenerate(automatic = false): Promise<void>
  {
    this.cancelGeneration();
    if (this.state.words.length < 2 || !this.options.generate) return;
    const words = automatic ? this.nextAutomaticPair() : chooseSentenceWords(this.state.words, undefined, this.options.random);
    this.ensureNeutralSentence(words);
    this.publish(true);
    await this.enrich(words, automatic);
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
    const removed = this.state.sentences.find((sentence) => sentence.id === id);
    if (removed) this.removedTexts.add(sentenceText(removed));
    if (this.removedTexts.size > MAX_SENTENCES) this.removedTexts.delete(this.removedTexts.values().next().value!);
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

  private ensureNeutralSentence(words = chooseSentenceWords(this.state.words, this.state.latestWord, this.options.random)): void
  {
    if (this.state.sentences.some((sentence) => sentence.origin === 'model')) return;
    this.state.sentences = words.length === 2 ? [createNeutralSentence(words)] : [];
  }

  private appendSentence(sentence: CloudSentence): void
  {
    // 새 결과를 마지막으로 옮겨 같은 문장이 다시 나와도 이번 입력의 결과를 먼저 보여 준다.
    this.state.sentences = this.state.sentences.filter((entry) => entry.origin === 'model' && entry.id !== sentence.id);
    this.state.sentences.push(sentence);
    this.state.sentences = this.state.sentences.slice(-MAX_SENTENCES);
    this.state.sentenceRevision++;
  }

  private async enrich(words: string[], automatic = false): Promise<void>
  {
    const revision = this.revision;
    const controller = new AbortController();
    this.controller = controller;
    this.lastPair = this.pairKey(words);
    this.pairPool = this.pairPool.filter((pair) => this.pairKey(pair) !== this.lastPair);
    this.state.generating = true;
    this.publish(false);
    let result: CloudSentence | null = null;
    try
    {
      const avoidSentences = [...this.state.sentences.map(sentenceText), ...this.removedTexts].filter((text) => words.every((word) => text.includes(word)));
      const generated = await this.options.generate!([...words], controller.signal, { avoidSentences });
      if (revision !== this.revision || controller.signal.aborted) return;
      result = generated && validateModelSentence({ text: sentenceText(generated), words: sentenceWords(generated) }, words);
      if (result && avoidSentences.includes(sentenceText(result))) result = null;
    }
    catch { /* 실패해도 선택한 두 단어는 바꾸지 않고 중립적인 연결 문장을 쓴다. */ }
    finally
    {
      if (revision === this.revision)
      {
        if (result) this.appendSentence(result);
        else if (!automatic || !this.state.sentences.length) this.appendSentence(createNeutralSentence(words));
        this.controller = undefined;
        this.state.generating = false;
        this.lastFinishedAt = Date.now();
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
        fs.writeFileSync(`${this.options.file}.tmp`, JSON.stringify({ version: 2, sentenceTheme: EXHIBITION_THEME.id, ...this.state, generating: false }), { mode: 0o600 });
        fs.renameSync(`${this.options.file}.tmp`, this.options.file);
      }
      catch (error) { this.state.storageAvailable = false; console.warn('단어 구름 기록 저장 실패:', String(error)); }
    }
    this.options.onChange?.(this.snapshot());
  }
}
