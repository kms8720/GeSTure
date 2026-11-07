import assert from 'node:assert/strict';
import { test, TestContext } from 'node:test';
import { correctWord, JamoSlot } from './wordCorrection.js';

const slots = (candidates: string[][]): JamoSlot[] => candidates.map((entry, index) => ({
  classId: `pose-${index}`, candidates: entry
}));

function mockWord(context: TestContext, correctedWord: string): void
{
  context.mock.method(globalThis, 'fetch', async () => Response.json({
    message: { content: JSON.stringify({ correctedWord, chosenJamo: [] }) }
  }));
}

test('행복: 실제 입력 3개와 AI 보완 3개를 구분한다', async (context) =>
{
  mockWord(context, '행복');
  const result = await correctWord(slots([
    ['ㅂ'], ['ㅒ'], ['ㅐ', 'ㅚ', 'ㅟ', 'ㅢ'], ['ㅣ'], ['ㅓ'], ['ㅎ']
  ]));
  assert.equal(result.correctedWord, '행복');
  assert.equal(result.source, 'llm');
  assert.equal(result.inputJamoCount, 3);
  assert.equal(result.supplementedJamoCount, 3);
  assert.match(result.note, /입력 자모 3개 반영/);
  assert.match(result.note, /AI 보완 3개/);
});

test('반복 자모에 같은 입력 슬롯을 두 번 사용하지 않는다', async (context) =>
{
  mockWord(context, '나눔');
  const result = await correctWord(slots([['ㄴ'], ['ㅏ'], ['ㅜ'], ['ㅁ']]));
  assert.equal(result.inputJamoCount, 4);
  assert.equal(result.supplementedJamoCount, 1);
});

test('모호한 후보를 재배정해 입력을 최대한 반영한다', async (context) =>
{
  mockWord(context, '비');
  const result = await correctWord(slots([['ㅂ', 'ㅣ'], ['ㅂ']]));
  assert.equal(result.inputJamoCount, 2);
  assert.equal(result.supplementedJamoCount, 0);
});

test('쌍자음도 기본 자모로 세어 완전 반영 시 보완은 0개다', async (context) =>
{
  mockWord(context, '꽃');
  const result = await correctWord(slots([['ㄱ'], ['ㄱ'], ['ㅗ'], ['ㅊ']]));
  assert.equal(result.inputJamoCount, 4);
  assert.equal(result.supplementedJamoCount, 0);
  assert.match(result.note, /입력 자모 4개 반영/);
  assert.match(result.note, /AI 보완 0개/);
});

test('Ollama 실패 시 단어장 보완을 AI 보완으로 설명하지 않는다', async (context) =>
{
  context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline test'); });
  const result = await correctWord(slots([['ㅂ']]));
  assert.equal(result.source, 'vocabulary');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.correctedWord, '비');
  assert.equal(result.inputJamoCount, 1);
  assert.equal(result.supplementedJamoCount, 1);
  assert.match(result.note, /입력 자모 1개 반영/);
  assert.match(result.note, /단어장 보완 1개/);
  assert.doesNotMatch(result.note, /AI 보완/);
});
