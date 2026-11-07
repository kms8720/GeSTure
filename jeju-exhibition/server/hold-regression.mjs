import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

// 실행 중인 로컬 테스트 서버의 인식 상태를 초기화한다.
const base = process.env.TEST_URL ?? 'http://127.0.0.1:3002';
const operatorToken = process.env.OPERATOR_TOKEN;
assert.ok(operatorToken, 'Set OPERATOR_TOKEN for the local test server');
async function request(path, body) {
  const response = await fetch(base + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` }, body: JSON.stringify(body)
  });
  assert.ok(response.ok);
  return response.json();
}
const rest = { thumb: 100, index: 100, middle: 100, ring: 100, pinky: 100 };
const pose = { thumb: 69, index: 95, middle: 45, ring: 44, pinky: 46 };
const other = { thumb: 82, index: 30, middle: 95, ring: 96, pinky: 95 };
const state = async () => (await request('/recognition-state')).recognitionState;
try {
  await request('/hand-state', rest);
  await request('/recognition/reset', {});
  await request('/hand-state', pose);
  assert.equal((await state()).slots.length, 0);
  await sleep(600);
  assert.equal((await state()).slots.length, 1, 'stationary pose must commit without another input');
  await sleep(600);
  assert.equal((await state()).slots.length, 1, 'stationary pose must not repeat');
  await request('/recognition/reset', {});
  await request('/hand-state', pose);
  await sleep(200);
  await request('/hand-state', other);
  await sleep(250);
  assert.equal((await state()).slots.length, 0, 'old pose timer must not commit new pose early');
  await sleep(350);
  assert.equal((await state()).slots.length, 1);
  assert.equal((await state()).slots[0].classId, 'ieung');
  await request('/recognition/reset', {});
  await request('/hand-state', pose);
  await request('/recognition/reset', {});
  await sleep(600);
  assert.equal((await state()).slots.length, 0, 'reset must cancel pending hold');
  console.log('PASS: stationary hold, no duplicates, pose change, reset cancellation');
} finally {
  await request('/hand-state', rest);
  await request('/recognition/reset', {});
}
