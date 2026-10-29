import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WordCloud, chooseSentenceWords } from './wordCloud.js';
import { createNeutralSentence, validateModelSentence } from './sentenceComposition.js';
import { sentenceText, sentenceWords } from '../shared/wordCloud.js';
import { VOCABULARY } from './vocabulary.js';
import { EXHIBITION_THEME } from '../shared/exhibitionTheme.js';

function fixture(options: Partial<ConstructorParameters<typeof WordCloud>[0]> = {})
{
  const directory = mkdtempSync(path.join(tmpdir(), 'gesture-cloud-'));
  const file = path.join(directory, 'cloud.json');
  const cloud = new WordCloud({ file, ...options });
  return { cloud, file, cleanup: () => { cloud.stopAutoGeneration(); cloud.cancelGeneration(); rmSync(directory, { recursive: true, force: true }); } };
}

test('real words accumulate without demo seeds, deduplicate and survive restart with their sentences', () =>
{
  const { cloud, file, cleanup } = fixture();
  try
  {
    assert.equal(cloud.snapshot().words.length, 0);
    cloud.addWord('달'); assert.equal(cloud.snapshot().sentences.length, 0);
    cloud.addWord('바람'); cloud.addWord('달'); cloud.addWord('<script>');
    const saved = cloud.snapshot();
    assert.deepEqual(saved.words, ['달', '바람']);
    assert.equal(saved.latestWord, '달');
    assert.ok(saved.sentences.length > 0);
    assert.deepEqual(new WordCloud({ file }).snapshot(), saved);
    assert.ok(saved.sentences.every((sentence) => new Set(sentenceWords(sentence)).size >= 2));
  }
  finally { cleanup(); }
});

test('free sentences link exact collected words and reject invalid or repeated anchors', () =>
{
  assert.equal(sentenceText(createNeutralSentence(['달', '바다'])), '‘달’과 ‘바다’가 나란히 놓였다.');
  const known = ['새벽', '보람', '평화', '대답'];
  const sentence = validateModelSentence({ text: '새벽부터 준비한 일을 마치고 나니 보람이 느껴졌다.', words: ['새벽', '보람'] }, known);
  assert.ok(sentence);
  assert.deepEqual(sentenceWords(sentence), ['새벽', '보람']);
  for (const candidate of [null,
    { text: '새벽에 보람을 느꼈다.', words: ['새벽', '미등록'] },
    { text: '새벽에 보람을 느꼈다.', words: ['새벽', '새벽'] },
    { text: '새벽에 보람을 느꼈다.', words: ['새벽', '평화'] },
    { text: '<script>새벽과 보람이 모였다.</script>', words: ['새벽', '보람'] },
    { text: '새벽에 보람을 느꼈다. 새벽은 밝았다.', words: ['새벽', '보람'] },
    { text: '새벽과 보람은', words: ['새벽', '보람'] },
    { text: '새벽에 보람을 느끼니 새벽이 반가웠다.', words: ['새벽', '보람'] },
    { text: '새벽에 씨발이라고 외치니 보람이 없었다.', words: ['새벽', '보람'] }
  ]) assert.equal(validateModelSentence(candidate, known), null);
});

test('removing a word removes dependent sentences in persisted state and caps a long exhibition', () =>
{
  const { cloud, file, cleanup } = fixture();
  try
  {
    cloud.addWord('달'); cloud.addWord('바다'); cloud.removeWord('달');
    assert.deepEqual(new WordCloud({ file }).snapshot().words, ['바다']);
    assert.equal(cloud.snapshot().sentences.length, 0);
    for (const word of VOCABULARY.slice(0, 65)) cloud.addWord(word);
    const state = cloud.snapshot();
    assert.ok(state.words.length <= 50); assert.ok(state.sentences.length <= 80);
    assert.ok(state.sentences.every((sentence) => sentenceWords(sentence).every((word) => state.words.includes(word))));
    assert.deepEqual(new WordCloud({ file }).snapshot(), state);
  }
  finally { cleanup(); }
});

test('deleted words cannot return through a late model response', async () =>
{
  let resolve!: (sentence: ReturnType<typeof createNeutralSentence>) => void;
  let started!: () => void;
  const ready = new Promise<void>((done) => { started = done; });
  const { cloud, cleanup } = fixture({ debounceMs: 0, generate: async () =>
  {
    started(); return new Promise((done) => { resolve = done; });
  } });
  try
  {
    cloud.addWord('달'); cloud.addWord('바다');
    // Keep the test alive while the production debounce timer is intentionally unref'd.
    await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('모델 시작 시간 초과')), 1000))]);
    assert.equal(cloud.snapshot().generating, true);
    cloud.removeWord('달'); resolve(createNeutralSentence(['달', '바다']));
    await new Promise((done) => setImmediate(done));
    assert.equal(cloud.snapshot().generating, false);
    assert.equal(cloud.snapshot().sentences.length, 0);
    assert.deepEqual(cloud.snapshot().words, ['바다']);
  }
  finally { cleanup(); }
});

test('failed model generation leaves usable sentences and a corrupt archive is preserved', async () =>
{
  const { cloud, file, cleanup } = fixture({ debounceMs: 0, generate: async () => { throw new Error('offline'); } });
  try
  {
    cloud.addWord('달'); cloud.addWord('바다');
    await new Promise((done) => setTimeout(done, 20));
    assert.ok(cloud.snapshot().sentences.length > 0);
    assert.equal(cloud.snapshot().generating, false);
    const sentence = cloud.snapshot().sentences[0]; cloud.removeSentence(sentence.id);
    assert.equal(cloud.snapshot().sentences.length, 0);
    writeFileSync(file, '{incomplete');
    const recovered = new WordCloud({ file }); recovered.addWord('달');
    assert.equal(recovered.snapshot().storageAvailable, false);
    assert.equal(readFileSync(file, 'utf8'), '{incomplete');
  }
  finally { cleanup(); }
});

test('migration preserves old words and backs up fixed templates before replacing them', () =>
{
  const { file, cleanup } = fixture();
  try
  {
    const legacy = { version: 1, words: ['새벽', '보람'], latestWord: '보람', sentences: [{ id: 'old', origin: 'template', parts: [
      { text: '보람', source: '보람' }, { text: '이 ', source: '' }, { text: '새벽', source: '새벽' }, { text: '을 천천히 깨운다.', source: '' }
    ] }] };
    writeFileSync(file, JSON.stringify(legacy));
    const upgraded = new WordCloud({ file });
    assert.deepEqual(upgraded.snapshot().words, ['새벽', '보람']);
    assert.equal(sentenceText(upgraded.snapshot().sentences[0]), '‘보람’과 ‘새벽’이 나란히 놓였다.');
    assert.deepEqual(JSON.parse(readFileSync(`${file}.v1-backup`, 'utf8')), legacy);
    upgraded.addWord('평화');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 2);
  }
  finally { cleanup(); }
});

test('a reviewed sentence replaces the fallback and is restored after restarting', async () =>
{
  const { cloud, file, cleanup } = fixture({ generate: async () => validateModelSentence({
    text: '새벽부터 준비한 일을 마치고 나니 보람이 느껴졌다.', words: ['새벽', '보람']
  }, ['새벽', '보람']) });
  try
  {
    cloud.addWord('새벽'); cloud.addWord('보람');
    await cloud.regenerate();
    assert.equal(cloud.snapshot().sentences.length, 1);
    assert.equal(cloud.snapshot().sentences[0].origin, 'model');
    assert.deepEqual(new WordCloud({ file }).snapshot(), cloud.snapshot());
    cloud.addWord('평화');
    assert.equal(cloud.snapshot().sentences[0].origin, 'model');
  }
  finally { cleanup(); }
});


test('random selection samples every collected word without replacement and can fix the new word', () =>
{
  const words = ['새벽', '보람', '평화', '대답'];
  const pairs = new Set<string>();
  for (let first = 0; first < 4; first++) for (let second = 0; second < 3; second++)
  {
    const draws = [(first + 0.5) / 4, (second + 0.5) / 3];
    pairs.add(chooseSentenceWords(words, undefined, () => draws.shift()!).join(','));
  }
  assert.equal(pairs.size, 12);
  for (let index = 0; index < 3; index++)
    assert.deepEqual(chooseSentenceWords(words, '대답', () => (index + 0.5) / 3), ['대답', words[index]]);
  const archive = VOCABULARY.slice(0, 30);
  assert.deepEqual(chooseSentenceWords(archive, archive[29], () => 0), [archive[29], archive[0]]);
  assert.deepEqual(chooseSentenceWords(['달', '달']), []);
});

async function waitUntil(check: () => boolean): Promise<void>
{
  const deadline = Date.now() + 1000;
  while (!check())
  {
    if (Date.now() >= deadline) throw new Error('문장 처리 시간 초과');
    await new Promise((done) => setTimeout(done, 5));
  }
}

test('each input, including a repeated word, is mandatory while manual regeneration draws both words', async () =>
{
  const calls: string[][] = [];
  const { cloud, cleanup } = fixture({ debounceMs: 0, random: () => 0, generate: async (words) =>
  {
    calls.push(words); return modelSentence(words);
  } });
  try
  {
    for (const word of ['새벽', '보람', '평화', '대답']) cloud.addWord(word);
    await waitUntil(() => calls.length === 1 && !cloud.snapshot().generating);
    assert.deepEqual(calls[0], ['대답', '새벽']);
    assert.deepEqual(sentenceWords(cloud.snapshot().sentences.slice(-1)[0]), calls[0]);
    cloud.addWord('대답');
    await waitUntil(() => calls.length === 2 && !cloud.snapshot().generating);
    assert.deepEqual(calls[1], ['대답', '새벽']);
    assert.equal(cloud.snapshot().words.length, 4);
    await cloud.regenerate();
    assert.deepEqual(calls[2], ['새벽', '보람']);
    assert.deepEqual(sentenceWords(cloud.snapshot().sentences.slice(-1)[0]), calls[2]);
  }
  finally { cleanup(); }
});

test('rejected or failed generation keeps the selected pair in its fallback even with older model sentences', async () =>
{
  let calls = 0;
  const { cloud, cleanup } = fixture({ debounceMs: 0, random: () => 0, generate: async (words) =>
  {
    calls++;
    if (calls === 1) return modelSentence(words);
    if (calls === 2) return createNeutralSentence(['보람', '평화']);
    throw new Error('offline');
  } });
  try
  {
    cloud.addWord('새벽'); cloud.addWord('보람');
    await waitUntil(() => calls === 1 && !cloud.snapshot().generating);
    const previous = cloud.snapshot().sentences[0];
    cloud.addWord('평화');
    await waitUntil(() => calls === 2 && !cloud.snapshot().generating);
    assert.equal(cloud.snapshot().sentences[0].id, previous.id);
    assert.equal(cloud.snapshot().sentences.slice(-1)[0].origin, 'template');
    assert.deepEqual(sentenceWords(cloud.snapshot().sentences.slice(-1)[0]), ['평화', '새벽']);
    cloud.addWord('대답');
    await waitUntil(() => calls === 3 && !cloud.snapshot().generating);
    assert.deepEqual(sentenceWords(cloud.snapshot().sentences.slice(-1)[0]), ['대답', '새벽']);
  }
  finally { cleanup(); }
});

test('a newer input cancels the old pair and ignores its late response', async () =>
{
  const pending: { words: string[]; signal: AbortSignal; resolve: (sentence: ReturnType<typeof createNeutralSentence>) => void }[] = [];
  const { cloud, cleanup } = fixture({ debounceMs: 0, random: () => 0, generate: (words, signal) => new Promise((resolve) => pending.push({ words, signal, resolve })) });
  try
  {
    cloud.addWord('새벽'); cloud.addWord('보람');
    await waitUntil(() => pending.length === 1);
    cloud.addWord('대답');
    await waitUntil(() => pending.length === 2);
    assert.equal(pending[0].signal.aborted, true);
    pending[1].resolve(createNeutralSentence(pending[1].words));
    await waitUntil(() => !cloud.snapshot().generating);
    pending[0].resolve(createNeutralSentence(pending[0].words));
    await new Promise((done) => setImmediate(done));
    assert.deepEqual(cloud.snapshot().sentences.map(sentenceWords), [['대답', '새벽']]);
  }
  finally { cleanup(); }
});


function modelSentence(words: string[])
{
  const text = `${words[0]}에 관한 글을 읽고 ${words[1]}에 대해 이야기를 나누었다.`;
  return validateModelSentence({ text, words }, words)!;
}

test('automatic generation visits every pair in random order without another input and resumes from an archive', async () =>
{
  const calls: string[][] = [];
  const { cloud, file, cleanup } = fixture();
  let restored: WordCloud | undefined;
  try
  {
    for (const word of ['새벽', '보람', '평화', '대답']) cloud.addWord(word);
    restored = new WordCloud({ file, autoGenerateMs: 5, random: () => 0, generate: async (words) =>
    {
      calls.push(words); return modelSentence(words);
    } });
    restored.startAutoGeneration();
    await waitUntil(() => calls.length >= 7);
    restored.stopAutoGeneration();
    const keys = calls.map((words) => words.slice().sort().join('|'));
    assert.equal(new Set(keys.slice(0, 6)).size, 6);
    assert.notEqual(keys[5], keys[6]);
    assert.ok(calls.some((words) => !words.includes('대답')));
    assert.ok(restored.snapshot().sentences.length >= 6);
  }
  finally { restored?.stopAutoGeneration(); restored?.cancelGeneration(); cleanup(); }
});

test('automatic requests never overlap and new input takes priority over a pending automatic request', async () =>
{
  let ready = true;
  const calls: { words: string[]; signal: AbortSignal; resolve: (sentence: ReturnType<typeof modelSentence>) => void }[] = [];
  const { cloud, cleanup } = fixture({ autoGenerateMs: 5, debounceMs: 0, random: () => 0,
    generate: (words, signal) => new Promise((resolve) => calls.push({ words, signal, resolve })) });
  try
  {
    cloud.addWord('새벽'); cloud.addWord('보람'); cloud.cancelGeneration();
    cloud.startAutoGeneration(() => ready);
    cloud.startAutoGeneration(() => ready);
    await waitUntil(() => calls.length === 1);
    await new Promise((done) => setTimeout(done, 25));
    assert.equal(calls.length, 1);
    ready = false;
    cloud.cancelGeneration();
    await new Promise((done) => setTimeout(done, 25));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, true);
    cloud.addWord('대답'); ready = true;
    await waitUntil(() => calls.length === 2);
    assert.deepEqual(calls[1].words, ['대답', '새벽']);
    calls[0].resolve(modelSentence(calls[0].words));
    await new Promise((done) => setImmediate(done));
    assert.equal(cloud.snapshot().generating, true);
    calls[1].resolve(modelSentence(calls[1].words));
    await waitUntil(() => calls.length === 3);
    assert.ok(cloud.snapshot().sentences.some((sentence) => sentenceWords(sentence).includes('대답')));
  }
  finally { cleanup(); }
});

test('automatic failures and verbatim repeats keep the existing sentence and retry later', async () =>
{
  let calls = 0;
  let previousTexts: string[] = [];
  const { cloud, cleanup } = fixture({ autoGenerateMs: 5, random: () => 0,
    generate: async (words, _signal, options) =>
    {
      calls++; previousTexts = options.avoidSentences;
      if (calls % 2 === 0) throw new Error('offline');
      return modelSentence(words);
    } });
  try
  {
    cloud.addWord('새벽'); cloud.addWord('보람');
    await cloud.regenerate();
    const original = cloud.snapshot().sentences;
    const revision = cloud.snapshot().sentenceRevision;
    cloud.startAutoGeneration();
    await waitUntil(() => calls >= 3 && !cloud.snapshot().generating);
    cloud.stopAutoGeneration();
    assert.deepEqual(cloud.snapshot().sentences, original);
    assert.equal(cloud.snapshot().sentenceRevision, revision);
    assert.ok(previousTexts.includes(sentenceText(original[0])));
    cloud.removeSentence(original[0].id);
    await cloud.regenerate();
    assert.ok(previousTexts.includes(sentenceText(original[0])));
    assert.ok(cloud.snapshot().sentences.every((sentence) => sentence.id !== original[0].id));
  }
  finally { cleanup(); }
});


test('theme migration preserves words and backs up unreviewed sentences without replaying them', async () =>
{
  const { file, cleanup } = fixture();
  let migrated: WordCloud | undefined;
  try
  {
    const words = ['새벽', '보람', '평화', '대답'];
    const old = { version: 2, words, latestWord: '대답', sentences: [modelSentence(['새벽', '보람'])] };
    writeFileSync(file, JSON.stringify(old));
    migrated = new WordCloud({ file, random: () => 0, generate: async (pair) => modelSentence(pair) });
    assert.deepEqual(migrated.snapshot().words, words);
    assert.equal(migrated.snapshot().latestWord, '대답');
    assert.ok(migrated.snapshot().sentences.every((sentence) => sentence.origin === 'template'));
    const backup = `${file}.before-${EXHIBITION_THEME.id}`;
    assert.deepEqual(JSON.parse(readFileSync(backup, 'utf8')), old);
    await migrated.regenerate();
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).sentenceTheme, EXHIBITION_THEME.id);
    assert.deepEqual(new WordCloud({ file }).snapshot(), migrated.snapshot());
    assert.deepEqual(JSON.parse(readFileSync(backup, 'utf8')), old);
  }
  finally { migrated?.cancelGeneration(); cleanup(); }
});
