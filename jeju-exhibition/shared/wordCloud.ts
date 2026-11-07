export type SentencePart = { text: string; source: string };
export type CloudSentence = { id: string; parts: SentencePart[]; origin: 'model' | 'template' };
export type WordCloudState = {
  words: string[];
  latestWord: string;
  sentences: CloudSentence[];
  sentenceRevision: number;
  generating: boolean;
  storageAvailable: boolean;
};

export const EMPTY_WORD_CLOUD: WordCloudState = {
  words: [], latestWord: '', sentences: [], sentenceRevision: 0, generating: false, storageAvailable: true
};

export const sentenceText = (sentence: CloudSentence): string => sentence.parts.map((part) => part.text).join('');
export const sentenceWords = (sentence: CloudSentence): string[] => sentence.parts.filter((part) => part.source).map((part) => part.source);
