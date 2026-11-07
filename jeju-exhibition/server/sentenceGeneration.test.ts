import assert from 'node:assert/strict';
import { test, TestContext } from 'node:test';
import { generateSentence } from './sentenceGeneration.js';

function mockSentences(context: TestContext, sentences: string[])
{
  const requests: { messages: { role: string; content: string }[] }[] = [];
  context.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) =>
  {
    requests.push(JSON.parse(String(options?.body)));
    return Response.json({ message: { content: JSON.stringify({ sentence: sentences[Math.min(requests.length - 1, sentences.length - 1)] }) } });
  });
  return requests;
}

test('입력 단어마다 한 개의 애니메이션 조각을 만들고 문장을 보존한다', async (context) =>
{
  mockSentences(context, ['비가 오는 밤 등불 아래 행복합니다.']);
  const result = await generateSentence(['등불', '비', '행복']);
  assert.equal(result.parts.map((piece) => piece.text).join(''), result.text);
  assert.deepEqual(result.parts.filter((piece) => piece.source).map((piece) => piece.source).sort(), ['등불', '비', '행복'].sort());
  assert.deepEqual(result.words, ['등불', '비', '행복']);
  assert.ok(result.model);
  assert.ok(result.elapsedMs >= 0);
});

test('문장에 같은 단어가 반복돼도 원래 노드는 한 번만 이동한다', async (context) =>
{
  mockSentences(context, ['마음에서 시작한 바람이 마음에 머뭅니다.']);
  const result = await generateSentence(['마음', '바람']);
  assert.equal(result.parts.filter((piece) => piece.source === '마음').length, 1);
  assert.equal(result.parts.map((piece) => piece.text).join(''), result.text);
});

test('별빛 안의 별은 별도 입력으로 세지 않고 재생성한다', async (context) =>
{
  const requests = mockSentences(context, ['별빛이 조용한 밤하늘을 비춥니다.', '별은 어두운 하늘에서 별빛을 나눕니다.']);
  const result = await generateSentence(['별', '별빛']);
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages[requests[1].messages.length - 1].content, /별도의 위치/);
  assert.deepEqual(result.parts.filter((piece) => piece.source).map((piece) => piece.source), ['별', '별빛']);
});

test('중국어 혼입, 누락, 명사 종결, 여러 문장을 거절한다', async (context) =>
{
  for (const sentence of [
    '바다의 风이 손에 부드럽게 닿습니다.',
    '바람이 부는 바다 위로 길게 흐릅니다.',
    '바다의 바람이 손에 닿는 순간.',
    '바다의 바람이 손에 닿습니다. 조용합니다.'
  ])
  {
    const requests = mockSentences(context, [sentence]);
    await assert.rejects(generateSentence(['바다', '바람', '손']), /문장 검증 실패/);
    assert.equal(requests.length, 2);
    context.mock.restoreAll();
  }
});

test('단어 누락을 구체적으로 알려 한 번 재시도한다', async (context) =>
{
  const requests = mockSentences(context, ['바람이 부는 바다 위로 길게 흐릅니다.', '바다에서 불어오는 바람이 손에 닿습니다.']);
  const result = await generateSentence(['바다', '바람', '손']);
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages[requests[1].messages.length - 1].content, /빠진 입력 단어.*손/);
  assert.match(result.text, /손/);
});

test('실제 생성에서 나온 되요 문장을 평서문으로 다시 만든다', async (context) =>
{
  const requests = mockSentences(context, ['행복한 사랑이 등불이 되요.', '행복과 사랑이 등불처럼 밤을 밝힙니다.']);
  const result = await generateSentence(['행복', '사랑', '등불']);
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages[requests[1].messages.length - 1].content, /평서문을 다\./);
  assert.equal(result.text, '행복과 사랑이 등불처럼 밤을 밝힙니다.');
});

test('잘못된 입력은 요청하지 않고 네트워크 실패는 재시도하지 않는다', async (context) =>
{
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async () =>
  {
    calls += 1;
    throw new DOMException('timed out', 'AbortError');
  });
  await assert.rejects(generateSentence(['바다']), /단어 2~4개/);
  await assert.rejects(generateSentence(['바다', '바다']), /단어 2~4개/);
  await assert.rejects(generateSentence(['바다', '<script>']), /단어 2~4개/);
  assert.equal(calls, 0);
  await assert.rejects(generateSentence(['바다', '손']), /timed out/);
  assert.equal(calls, 1);
});
