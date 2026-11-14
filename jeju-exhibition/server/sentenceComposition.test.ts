import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test, { after, beforeEach } from 'node:test';
import { generateCloudSentence, parseSentenceCandidates, selectReviewedSentence } from './sentenceComposition.js';
import { sentenceText, sentenceWords } from '../shared/wordCloud.js';

const known = ['새벽', '보람'];
const first = '새벽을 각자의 몸짓으로 표현한 우리는 함께 장면을 완성하는 보람을 나누었다.';
const second = '우리는 서로 다른 손끝으로 새벽을 그리며 함께 채운 그림에 보람을 담았다.';
const acceptedReview = {
  best: 1, natural: true, coherent: true, usesWords: true, themeAligned: true, respectful: true,
  themeEvidence: '서로 다른 손끝으로 새벽을 그리며 함께 채운 그림'
};
const originalOrigin = process.env.OLLAMA_URL;
let calls: unknown[] = [];
let rejectReview = false;
let malformed = false;
let stallBody = false;
let stallReview = false;
let firstDelay = 0;
let wrongPair = false;
let reviewOverrides: Record<string, unknown> = {};
const mock = createServer((request, response) =>
{
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () =>
  {
    calls.push(JSON.parse(body));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    if (stallBody || (stallReview && calls.length === 2)) { response.flushHeaders(); return; }
    const content = calls.length === 1 ? { candidates: wrongPair ? ['서로의 대답을 듣고 나니 마음에 평화가 찾아왔다.'] : [first, second] } : { ...acceptedReview, best: rejectReview ? -1 : 1, coherent: !rejectReview, ...reviewOverrides };
    const output = JSON.stringify({ message: { content: malformed ? '{invalid' : JSON.stringify(content) } });
    if (calls.length === 1 && firstDelay) setTimeout(() => response.end(output), firstDelay);
    else response.end(output);
  });
});
await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
beforeEach(() => { process.env.OLLAMA_URL = origin; calls = []; rejectReview = false; malformed = false; stallBody = false; stallReview = false; firstDelay = 0; wrongPair = false; reviewOverrides = {}; });
after(async () =>
{
  if (originalOrigin === undefined) delete process.env.OLLAMA_URL;
  else process.env.OLLAMA_URL = originalOrigin;
  mock.closeAllConnections(); await new Promise<void>((resolve) => mock.close(() => resolve()));
});

test('the model writes sentences and an independent review selects the displayed candidate', async () =>
{
  const result = await generateCloudSentence(known, new AbortController().signal);
  assert.ok(result); assert.equal(sentenceText(result), second);
  assert.deepEqual(sentenceWords(result), known);
  assert.equal(calls.length, 2);
  const writer = calls[0] as { format: { type: string; properties: { candidates: { items: { type: string } } } }; messages: { content: string }[] };
  assert.equal(writer.format.type, 'object');
  assert.equal(writer.format.properties.candidates.items.type, 'string');
  assert.ok(writer.messages[0].content.includes(JSON.stringify(known)));
  const reviewer = calls[1] as { messages: { content: string }[] };
  assert.ok(reviewer.messages[0].content.includes(JSON.stringify([first, second])));
  assert.ok(writer.messages[0].content.includes('장애예술페스타 열린 감각'));
  assert.ok(reviewer.messages[0].content.includes('themeAligned'));
  assert.ok(reviewer.messages[0].content.includes('respectful'));
  assert.ok(reviewer.messages[0].content.includes('themeEvidence'));
});

test('a negative semantic review or missing review flags never publishes a candidate', async () =>
{
  rejectReview = true;
  assert.equal(await generateCloudSentence(known, new AbortController().signal), null);
  const candidates = parseSentenceCandidates({ candidates: [first, first] }, known);
  assert.equal(candidates.length, 1);
  for (const review of [null, { best: 0 }, { best: 0, natural: true, coherent: false, usesWords: true },
    { best: 99, natural: true, coherent: true, usesWords: true }]) assert.equal(selectReviewedSentence(review, candidates), null);
});

test('malformed model output does not proceed to review', async () =>
{
  malformed = true;
  await assert.rejects(generateCloudSentence(known, new AbortController().signal));
  assert.equal(calls.length, 1);
});

test('the deadline bounds stalled response bodies and cancellation stops the complete pipeline', async () =>
{
  stallBody = true;
  const start = Date.now();
  await assert.rejects(generateCloudSentence(known, new AbortController().signal, { timeoutMs: 100 }));
  assert.ok(Date.now() - start < 1000);
  const controller = new AbortController();
  const task = generateCloudSentence(known, controller.signal);
  controller.abort();
  await assert.rejects(task);
});

test('writing and reviewing share one total deadline instead of restarting the clock', async () =>
{
  firstDelay = 70; stallReview = true;
  const start = Date.now();
  await assert.rejects(generateCloudSentence(known, new AbortController().signal, { timeoutMs: 120 }));
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - start < 300);
});


test('the model cannot replace the randomly selected pair, omit an anchor or choose from a larger pool', async () =>
{
  wrongPair = true;
  assert.equal(await generateCloudSentence(known, new AbortController().signal), null);
  assert.equal(calls.length, 1);
  for (const words of [[], ['새벽'], ['새벽', '새벽'], ['새벽', '보람', '평화']])
    assert.equal(await generateCloudSentence(words, new AbortController().signal), null);
  assert.equal(calls.length, 1);
  assert.deepEqual(parseSentenceCandidates({ candidates: ['새벽에 이웃의 일을 도와주고 집으로 돌아왔다.'] }, known), []);
});


test('verbatim archived sentences are rejected before review and supplied as examples to avoid', async () =>
{
  assert.equal(await generateCloudSentence(known, new AbortController().signal, { avoidSentences: [first, second] }), null);
  assert.equal(calls.length, 1);
  const writer = calls[0] as { messages: { content: string }[] };
  assert.ok(writer.messages[0].content.includes(first));
  assert.ok(writer.messages[0].content.includes('반복 금지'));
});


test('grammatical sentences without the exhibition theme never pass the review gate', () =>
{
  const candidates = parseSentenceCandidates({ candidates: [first, second] }, known);
  const review = { ...acceptedReview, themeAligned: undefined };
  assert.equal(selectReviewedSentence(review, candidates), null);
  assert.equal(selectReviewedSentence({ ...review, themeAligned: false }, candidates), null);
  assert.equal(selectReviewedSentence({ ...review, themeAligned: 'true' }, candidates), null);
  assert.equal(selectReviewedSentence({ ...review, themeAligned: true }, candidates)?.id, candidates[1].id);
});

test('grounded poetic and inflected actions reach review using just the sentence text', () =>
{
  const text = '서로 다른 손끝으로 함께 빚은 바다에 각자의 기억이 포개졌다.';
  const candidates = parseSentenceCandidates({ candidates: [text] }, ['바다', '기억']);
  assert.deepEqual(candidates.map(sentenceText), [text]);
});

test('a duplicate ending or a missing or repeated word does not block a valid second candidate', () =>
{
  for (const invalid of [
    null, { text: first }, first + ' 다.', first.replace('보람', '평화'), first.replace('보람', '보람과 보람')
  ])
  {
    const candidates = parseSentenceCandidates({ candidates: [invalid, second] }, known);
    assert.deepEqual(candidates.map(sentenceText), [second]);
  }
});

test('a declarative ending without a final period can reach review', () =>
{
  const candidates = parseSentenceCandidates({ candidates: [second.slice(0, -1)] }, known);
  assert.deepEqual(candidates.map(sentenceText), [second]);
});

test('theme evidence must come from the selected sentence and every semantic flag must be true', () =>
{
  const candidates = parseSentenceCandidates({ candidates: [first, second] }, known);
  for (const themeEvidence of [undefined, null, '', '함께', '모두가 동등하게 작품을 만들었다.', '각자의 몸짓으로 표현한'])
    assert.equal(selectReviewedSentence({ ...acceptedReview, themeEvidence }, candidates), null);
  for (const flag of ['natural', 'coherent', 'usesWords', 'themeAligned', 'respectful'])
    for (const value of [undefined, false, 'true'])
      assert.equal(selectReviewedSentence({ ...acceptedReview, [flag]: value }, candidates), null);
  for (const best of [-1, 99, '1', 0.5])
    assert.equal(selectReviewedSentence({ ...acceptedReview, best }, candidates), null);
});

test('an exact quote about an object acting alone is not evidence of shared expression', () =>
{
  const text = '대답한 새벽의 불꽃이 야경을 가득 채웠다.';
  const candidates = parseSentenceCandidates({ candidates: [text] }, ['새벽', '대답']);
  assert.equal(candidates.length, 1);
  assert.equal(selectReviewedSentence({ ...acceptedReview, best: 0, themeEvidence: text }, candidates), null);
});

test('a fabricated theme explanation cannot publish a model sentence', async () =>
{
  reviewOverrides = { themeEvidence: '장애와 비장애가 어우러지는 참여형 예술이다.' };
  assert.equal(await generateCloudSentence(known, new AbortController().signal), null);
  assert.equal(calls.length, 2);
});

test('a negative respect judgment cannot publish a model sentence', async () =>
{
  reviewOverrides = { respectful: false };
  assert.equal(await generateCloudSentence(known, new AbortController().signal), null);
  assert.equal(calls.length, 2);
});

test('the reviewer selects from the remaining candidates after repeated text is removed', async () =>
{
  reviewOverrides = { best: 0 };
  const result = await generateCloudSentence(known, new AbortController().signal, { avoidSentences: [first] });
  assert.ok(result);
  assert.equal(sentenceText(result), second);
  const reviewer = calls[1] as { format: { properties: { best: { enum: number[] } } } };
  assert.deepEqual(reviewer.format.properties.best.enum, [-1, 0]);
});
