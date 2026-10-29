import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test, { after, beforeEach } from 'node:test';
import { generateCloudSentence, parseSentenceCandidates, selectReviewedSentence } from './sentenceComposition.js';
import { sentenceText, sentenceWords } from '../shared/wordCloud.js';

const known = ['새벽', '보람'];
const first = { text: '새벽부터 준비한 일을 마치고 나니 보람이 느껴졌다.', words: ['새벽', '보람'], action: '준비한 일을 마치고' };
const second = { text: '새벽에 이웃의 일을 도와주고 나니 보람이 느껴졌다.', words: ['새벽', '보람'] };
const originalOrigin = process.env.OLLAMA_URL;
let calls: unknown[] = [];
let rejectReview = false;
let malformed = false;
let stallBody = false;
let stallReview = false;
let firstDelay = 0;
let wrongPair = false;
const mock = createServer((request, response) =>
{
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () =>
  {
    calls.push(JSON.parse(body));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    if (stallBody || (stallReview && calls.length === 2)) { response.flushHeaders(); return; }
    const content = calls.length === 1 ? { candidates: wrongPair ? [{ text: '서로의 대답을 듣고 나니 마음에 평화가 찾아왔다.', words: ['대답', '평화'] }] : [first, second] } : { best: rejectReview ? -1 : 1, natural: true, coherent: !rejectReview, usesWords: true };
    const output = JSON.stringify({ message: { content: malformed ? '{invalid' : JSON.stringify(content) } });
    if (calls.length === 1 && firstDelay) setTimeout(() => response.end(output), firstDelay);
    else response.end(output);
  });
});
await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
beforeEach(() => { process.env.OLLAMA_URL = origin; calls = []; rejectReview = false; malformed = false; stallBody = false; stallReview = false; firstDelay = 0; wrongPair = false; });
after(async () =>
{
  if (originalOrigin === undefined) delete process.env.OLLAMA_URL;
  else process.env.OLLAMA_URL = originalOrigin;
  mock.closeAllConnections(); await new Promise<void>((resolve) => mock.close(() => resolve()));
});

test('the model writes sentences and an independent review selects the displayed candidate', async () =>
{
  const result = await generateCloudSentence(known, new AbortController().signal);
  assert.ok(result); assert.equal(sentenceText(result), second.text);
  assert.deepEqual(sentenceWords(result), known);
  assert.equal(calls.length, 2);
  const writer = calls[0] as { format: { type: string }; messages: { content: string }[] };
  assert.equal(writer.format.type, 'object');
  assert.ok(writer.messages[0].content.includes(JSON.stringify(known)));
  assert.ok(writer.messages[0].content.includes('빠짐없이 사용'));
  const reviewer = calls[1] as { messages: { content: string }[] };
  assert.ok(reviewer.messages[0].content.includes('문장 편집자'));
});

test('a negative semantic review or missing review flags never publishes a candidate', async () =>
{
  rejectReview = true;
  assert.equal(await generateCloudSentence(known, new AbortController().signal), null);
  const candidates = parseSentenceCandidates({ candidates: [first, second, first] }, known);
  assert.equal(candidates.length, 2);
  assert.equal(parseSentenceCandidates({ candidates: [{
    words: ['새벽', '보람'], text: '새벽에 글을 쓰며 보람을 느끼며 하루를 시작했다.'
  }] }, known).length, 0);
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
  for (const candidate of [
    { text: '새벽에 이웃의 일을 도와주고 집으로 돌아왔다.', words: known },
    { text: '새벽에 이웃의 일을 도와주고 집으로 돌아왔다.', words: ['새벽'] }
  ]) assert.deepEqual(parseSentenceCandidates({ candidates: [candidate] }, known), []);
});


test('verbatim archived sentences are rejected before review and supplied as examples to avoid', async () =>
{
  assert.equal(await generateCloudSentence(known, new AbortController().signal, { avoidSentences: [first.text, second.text] }), null);
  assert.equal(calls.length, 1);
  const writer = calls[0] as { messages: { content: string }[] };
  assert.ok(writer.messages[0].content.includes(first.text));
  assert.ok(writer.messages[0].content.includes('반복 금지'));
});
