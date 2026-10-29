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
    this.ensureNeutralSentence();
    this.publish(true);
    if (this.state.words.length >= 2 && this.options.generate)
    {
      this.timer = setTimeout(() => { this.timer = undefined; void this.enrich(); }, this.options.debounceMs ?? 700);
      this.timer.unref();
    }
  }

  async regenerate(): Promise<void>
  {
    this.cancelGeneration();
    if (this.state.words.length < 2 || !this.options.generate) return;
    this.ensureNeutralSentence();
    this.publish(true);
    await this.enrich();
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

  private ensureNeutralSentence(): void
  {
    if (this.state.sentences.some((sentence) => sentence.origin === 'model')) return;
    const latest = this.state.latestWord;
    const other = this.state.words.filter((word) => word !== latest).slice(-1)[0];
    this.state.sentences = other ? [createNeutralSentence([latest, other])] : [];
  }

  private appendSentence(sentence: CloudSentence): void
  {
    // 검토된 문장이 생기면 기계적인 대체 문장은 전시 후보에서 제외한다.
    this.state.sentences = this.state.sentences.filter((entry) => entry.origin === 'model');
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
      const words = [this.state.latestWord, ...this.state.words.filter((word) => word !== this.state.latestWord).slice(-11)];
      const generated = await this.options.generate!(words, this.state.latestWord, controller.signal);
      if (revision !== this.revision || controller.signal.aborted) return;
      const validated = generated && validateModelSentence({ text: sentenceText(generated), words: sentenceWords(generated) }, this.state.words);
      if (validated) this.appendSentence(validated);
    }
    catch { /* 기존 검토 문장, 없으면 중립적인 연결 문장으로 계속한다. */ }
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
        fs.writeFileSync(`${this.options.file}.tmp`, JSON.stringify({ version: 2, ...this.state, generating: false }), { mode: 0o600 });
        fs.renameSync(`${this.options.file}.tmp`, this.options.file);
      }
      catch (error) { this.state.storageAvailable = false; console.warn('단어 구름 기록 저장 실패:', String(error)); }
    }
    this.options.onChange?.(this.snapshot());
  }
}
