import { isValidKoreanWord } from './hangul.js';
import { CloudSentence, generateSentence } from './sentenceGeneration.js';

export type WordCloudState = {
  words: string[];
  latestWord: string;
  sentences: CloudSentence[];
  generating: boolean;
  error: string | null;
  updatedAt: string;
};

export class WordCloud
{
  readonly state: WordCloudState = {
    words: [], latestWord: '', sentences: [], generating: false, error: null, updatedAt: ''
  };
  private pendingWords: string[] | null = null;
  private lastRequest = '';

  constructor(
    private readonly onChange: (state: WordCloudState) => void,
    private readonly generate: typeof generateSentence = generateSentence
  ) {}

  addWord(word: string): void
  {
    if (!isValidKoreanWord(word)) return;

    this.state.words = [...this.state.words.filter(entry => entry !== word), word].slice(-50);
    this.state.latestWord = word;
    this.state.sentences = this.state.sentences.filter(sentence =>
      sentence.words.every(entry => this.state.words.includes(entry)));

    const words = this.state.words.slice(-3);
    const request = JSON.stringify(words);
    if (words.length >= 2 && (request !== this.lastRequest || this.state.error))
    {
      this.lastRequest = request;
      this.pendingWords = words;
      this.state.error = null;
    }
    this.publish();
    if (!this.state.generating && this.pendingWords) void this.drain();
  }

  private publish(): void
  {
    this.state.updatedAt = new Date().toISOString();
    this.onChange(this.state);
  }

  private async drain(): Promise<void>
  {
    this.state.generating = true;
    this.publish();
    while (this.pendingWords)
    {
      const words = this.pendingWords;
      this.pendingWords = null;
      try
      {
        const sentence = await this.generate(words);
        // 생성 중 새 단어가 도착하면 오래된 결과 대신 최신 단어 묶음으로 다시 잇는다.
        if (!this.pendingWords)
        {
          this.state.sentences = [...this.state.sentences.filter(entry => entry.text !== sentence.text), sentence].slice(-8);
          this.state.error = null;
        }
      }
      catch (error)
      {
        if (!this.pendingWords)
        {
          this.state.error = error instanceof Error ? error.message : String(error);
        }
      }
    }
    this.state.generating = false;
    this.publish();
  }
}
