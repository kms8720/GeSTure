import fs from 'node:fs';
import path from 'node:path';
import { CloudSentence, EMPTY_WORD_CLOUD, WordCloudState, sentenceText, sentenceWords } from '../shared/wordCloud.js';
import { isAllowedOutput } from './wordCorrection.js';
import { createNeutralSentence, validateModelSentence } from './sentenceComposition.js';
export { generateCloudSentence } from './sentenceComposition.js';

const MAX_WORDS = 50;
const MAX_SENTENCES = 80;

type Options = {
  file: string;
  onChange?: (state: WordCloudState) => void;
  generate?: (words: string[], signal: AbortSignal) => Promise<CloudSentence | null>;
  debounceMs?: number;
  random?: () => number;
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

  constructor(private options: Options)
  {
    if (!fs.existsSync(options.file)) return;
    try
    {
      const saved = JSON.parse(fs.readFileSync(options.file, 'utf8'));
      if (![1, 2].includes(saved.version) || !Array.isArray(saved.words) || !Array.isArray(saved.sentences)) throw new Error('잘못된 저장 형식');
      const words: string[] = [...new Set<string>(saved.words.filter((word: unknown) => typeof word === 'string' && isAllowedOutput(word)))].slice(-MAX_WORDS);
      this.state = { ...this.state, words, latestWord: words.includes(saved.latestWord) ? saved.latestWord : words[words.length - 1] ?? '' };
      const sentences: CloudSentence[] = [];
      if (saved.version === 1)
      {
        this.ensureNeutralSentence();
        // 기존 고정 틀 문장은 따로 보존하고 전시 후보에서는 제외한다. 단어 기록은 이어 간다.
        const backup = `${options.file}.v1-backup`;
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
      if (saved.version === 2) this.state.sentences = sentences.slice(-MAX_SENTENCES);
    }
    catch (error)
    {
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
    const words = chooseSentenceWords(this.state.words, word, this.options.random);
    this.ensureNeutralSentence(words);
    this.publish(true);
    if (this.state.words.length >= 2 && this.options.generate)
    {
      this.timer = setTimeout(() => { this.timer = undefined; void this.enrich(words); }, this.options.debounceMs ?? 700);
      this.timer.unref();
    }
  }

  async regenerate(): Promise<void>
  {
    this.cancelGeneration();
    if (this.state.words.length < 2 || !this.options.generate) return;
    const words = chooseSentenceWords(this.state.words, undefined, this.options.random);
    this.ensureNeutralSentence(words);
    this.publish(true);
    await this.enrich(words);
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
  }

  private async enrich(words: string[]): Promise<void>
  {
    const revision = this.revision;
    const controller = new AbortController();
    this.controller = controller;
    this.state.generating = true;
    this.publish(false);
    let result: CloudSentence | null = null;
    try
    {
      const generated = await this.options.generate!([...words], controller.signal);
      if (revision !== this.revision || controller.signal.aborted) return;
      result = generated && validateModelSentence({ text: sentenceText(generated), words: sentenceWords(generated) }, words);
    }
    catch { /* 실패해도 선택한 두 단어는 바꾸지 않고 중립적인 연결 문장을 쓴다. */ }
    finally
    {
      if (revision === this.revision)
      {
        this.appendSentence(result ?? createNeutralSentence(words));
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
        fs.writeFileSync(`${this.options.file}.tmp`, JSON.stringify({ version: 2, ...this.state, generating: false }), { mode: 0o600 });
        fs.renameSync(`${this.options.file}.tmp`, this.options.file);
      }
      catch (error) { this.state.storageAvailable = false; console.warn('단어 구름 기록 저장 실패:', String(error)); }
    }
    this.options.onChange?.(this.snapshot());
  }
}
