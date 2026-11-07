import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import test, { after } from 'node:test';
import { VOCABULARY } from './vocabulary.js';

let responseWord = '사랑';
let malformed = false;
let stalled = false;
let headersOnly = false;
let calls = 0;
const mock = createServer((request, response) =>
{
  request.resume();
  request.on('end', () =>
  {
    calls++;
    if (stalled)
    {
      if (headersOnly) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.flushHeaders(); }
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ message: { content: malformed ? 'invalid JSON' : JSON.stringify({ correctedWord: responseWord }) } }));
  });
});
await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
const address = mock.address() as { port: number };
process.env.OLLAMA_URL = `http://127.0.0.1:${address.port}`;
process.env.OLLAMA_TIMEOUT_MS = '200';
process.env.WORD_DEADLINE_MS = '200';
process.env.EXHIBITION_STRICT = '1';
const { correctWord, isAllowedOutput, matchVocabulary, warmUpOllama } = await import('./wordCorrection.js');
const slots = ['ㅅ', 'ㅏㅓ', 'ㄹ', 'ㅏㅗ', 'ㅇ', 'ㅁㄴ'].map((group, i) => ({ classId: String(i), candidates: [...group] }));
after(async () => { mock.closeAllConnections(); await new Promise<void>((resolve) => mock.close(() => resolve())); });

test('an allowed model word is used and decomposed consistently', async () =>
{
  const result = await correctWord(slots);
  assert.equal(result.source, 'llm'); assert.equal(result.correctedWord, '사랑');
  assert.equal(result.composedText, '사랑');
});

test('out of vocabulary and blocked outputs fail closed without a second model call', async () =>
{
  for (const word of ['습수', '병신', '개새끼'])
  {
    responseWord = word; const before = calls;
    const result = await correctWord(slots);
    assert.equal(calls - before, 1); assert.equal(result.source, 'vocabulary');
    assert.ok(VOCABULARY.includes(result.correctedWord));
    assert.ok(result.candidates.every(isAllowedOutput));
    assert.ok(!result.note.includes(word));
  }
});

test('the final vocabulary gate still rejects a blocked word if the list is edited', () =>
{
  VOCABULARY.push('병신');
  try { assert.equal(isAllowedOutput('병신'), false); assert.ok(matchVocabulary(slots, 500).every((entry) => entry.word !== '병신')); }
  finally { VOCABULARY.pop(); }
});

test('malformed JSON and a stalled model return a bounded vocabulary fallback', async () =>
{
  malformed = true;
  assert.equal((await correctWord(slots)).source, 'vocabulary');
  malformed = false; stalled = true;
  const startedAt = Date.now(); const before = calls; const result = await correctWord(slots);
  assert.equal(result.source, 'vocabulary'); assert.equal(result.status, 'unavailable');
  assert.equal(calls - before, 1);
  assert.ok(Date.now() - startedAt >= 150 && Date.now() - startedAt < 1200);
  stalled = false;
});

test('reset cancellation stops waiting for the model', async () =>
{
  stalled = true; const controller = new AbortController();
  const task = correctWord(slots, { signal: controller.signal }); controller.abort();
  assert.equal((await task).source, 'vocabulary'); stalled = false;
});

test('warmup consumes the response body and fails within the deadline when only headers arrive', async () =>
{
  stalled = true; headersOnly = true;
  const startedAt = Date.now(); const result = await warmUpOllama();
  assert.equal(result.ok, false);
  assert.ok(Date.now() - startedAt >= 150 && Date.now() - startedAt < 1200);
  stalled = false; headersOnly = false;
});

test('non-exhibition semantic verification shares the total deadline', async () =>
{
  let requests = 0;
  const slow = createServer((request, response) =>
  {
    request.resume(); request.on('end', () =>
    {
      requests++;
      if (requests > 1) return;
      setTimeout(() => response.end(JSON.stringify({ message: { content: '{"correctedWord":"습수"}' } })), 120);
    });
  });
  await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
  try
  {
    const script = `import {correctWord} from './server/wordCorrection.ts'; const r=await correctWord(${JSON.stringify(slots)}); console.log(JSON.stringify({source:r.source,elapsedMs:r.elapsedMs}));`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      env: { ...process.env, EXHIBITION_STRICT: '0', OLLAMA_URL: `http://127.0.0.1:${(slow.address() as { port: number }).port}`, OLLAMA_TIMEOUT_MS: '250', WORD_DEADLINE_MS: '250' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = ''; child.stdout.on('data', (chunk) => { output += chunk; });
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    assert.equal(code, 0); const result = JSON.parse(output);
    assert.equal(requests, 2); assert.equal(result.source, 'vocabulary');
    assert.ok(result.elapsedMs < 350, `두 호출이 전체 시간 상한을 넘김: ${result.elapsedMs}`);
  }
  finally { slow.closeAllConnections(); await new Promise<void>((resolve) => slow.close(() => resolve())); }
});
