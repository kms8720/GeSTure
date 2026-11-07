import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WordCloud } from './wordCloud.js';
import { CloudSentence } from './sentenceGeneration.js';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const sentence = (words: string[]): CloudSentence => ({
  text: `${words.join(' ')} 함께합니다.`,
  words: [...words],
  parts: [...words.flatMap(word => [{ text: word, source: word }, { text: ' ', source: '' }]),
    { text: '함께합니다.', source: '' }],
  model: 'test', elapsedMs: 1
});

test('첫 단어는 즉시 쌓이고 서로 다른 두 단어부터 한 번만 생성한다', async () =>
{
  const calls: string[][] = [];
  const cloud = new WordCloud(() => {}, async words => { calls.push(words); return sentence(words); });
  cloud.addWord('바다');
  assert.deepEqual(cloud.state.words, ['바다']);
  assert.equal(calls.length, 0);
  cloud.addWord('손');
  await settle();
  assert.deepEqual(calls, [['바다', '손']]);
  cloud.addWord('손');
  await settle();
  assert.deepEqual(cloud.state.words, ['바다', '손']);
  assert.equal(calls.length, 1);
  assert.equal(cloud.state.sentences.length, 1);
  assert.equal(cloud.state.generating, false);
});

test('생성 중 새 단어는 최신 묶음으로 합치고 오래된 응답을 버린다', async () =>
{
  const pending: { words: string[]; resolve: (value: CloudSentence) => void }[] = [];
  const cloud = new WordCloud(() => {}, words => new Promise(resolve => pending.push({ words, resolve })));
  cloud.addWord('바다');
  cloud.addWord('손');
  cloud.addWord('빛');
  cloud.addWord('마음');
  assert.equal(pending.length, 1, '동시에 두 요청을 실행하지 않는다');
  assert.equal(cloud.state.generating, true);
  pending[0].resolve(sentence(pending[0].words));
  await settle();
  assert.equal(cloud.state.sentences.length, 0, '오래된 응답을 화면에 내보내지 않는다');
  assert.equal(pending.length, 2);
  assert.deepEqual(pending[1].words, ['손', '빛', '마음']);
  pending[1].resolve(sentence(pending[1].words));
  await settle();
  assert.deepEqual(cloud.state.sentences.map(entry => entry.words), [['손', '빛', '마음']]);
  assert.equal(cloud.state.generating, false);
});

test('생성 실패 시 기존 문장을 유지하고 같은 최신 단어로도 재시도한다', async () =>
{
  let calls = 0;
  const cloud = new WordCloud(() => {}, async words =>
  {
    calls += 1;
    if (calls === 2) throw new Error('모델 연결 실패');
    return sentence(words);
  });
  cloud.addWord('바다');
  cloud.addWord('손');
  await settle();
  const first = cloud.state.sentences[0].text;
  cloud.addWord('빛');
  await settle();
  assert.equal(cloud.state.error, '모델 연결 실패');
  assert.equal(cloud.state.sentences[0].text, first);
  assert.equal(cloud.state.generating, false);
  cloud.addWord('빛');
  await settle();
  assert.equal(calls, 3);
  assert.equal(cloud.state.error, null);
  assert.equal(cloud.state.sentences.length, 2);
});

test('단어는 50개, 문장은 8개까지만 보관한다', async () =>
{
  const cloud = new WordCloud(() => {}, async words => sentence(words));
  const words = Array.from({ length: 53 }, (_, index) => String.fromCharCode(0xac00 + index));
  for (const word of words)
  {
    cloud.addWord(word);
    await settle();
  }
  assert.deepEqual(cloud.state.words, words.slice(-50));
  assert.equal(cloud.state.latestWord, words[52]);
  assert.equal(cloud.state.sentences.length, 8);
  assert.ok(cloud.state.sentences.every(entry => entry.words.every(word => cloud.state.words.includes(word))));
  cloud.addWord('<script>');
  assert.deepEqual(cloud.state.words, words.slice(-50));
});
