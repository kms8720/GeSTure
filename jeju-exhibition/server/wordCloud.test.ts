import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WordCloud, composeCloudSentence, validateSentencePlan } from './wordCloud.js';
import { sentenceText, sentenceWords } from '../shared/wordCloud.js';
import { VOCABULARY } from './vocabulary.js';

function fixture(options: Partial<ConstructorParameters<typeof WordCloud>[0]> = {})
{
  const directory = mkdtempSync(path.join(tmpdir(), 'gesture-cloud-'));
  const file = path.join(directory, 'cloud.json');
  const cloud = new WordCloud({ file, ...options });
  return { cloud, file, cleanup: () => { cloud.cancelGeneration(); rmSync(directory, { recursive: true, force: true }); } };
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

test('sentence plans accept only collected words and reviewed templates, with correct Korean particles', () =>
{
  assert.equal(sentenceText(composeCloudSentence(['달', '바다'], 0, 'template')), '달은 바다와 만난다.');
  assert.equal(sentenceText(composeCloudSentence(['바다', '달'], 2, 'template')), '바다가 달을 천천히 깨운다.');
  for (const plan of [null, { template: 5, words: ['달', '바다'] }, { template: 3, words: ['달', '바다'] },
    { template: 0, words: ['달', '달'] }, { template: 0, words: ['달', '미등록'] },
    { template: 0, words: ['달', '<img src=x onerror=alert(1)>'] }]) assert.equal(validateSentencePlan(plan, ['달', '바다']), null);
  assert.ok(validateSentencePlan({ template: 0, words: ['달', '바다'] }, ['달', '바다']));
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
  let resolve!: (sentence: ReturnType<typeof composeCloudSentence>) => void;
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
    cloud.removeWord('달'); resolve(composeCloudSentence(['달', '바다'], 0, 'model'));
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
