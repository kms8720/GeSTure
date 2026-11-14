import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { connectionError, requestJson, sessionReady, waitFor } from './readiness.mjs';

function clock() {
  let time = 0;
  const reports = [];
  return { reports, now: () => time, sleep: async ms => { time += ms; }, onRetry: report => reports.push(report) };
}

test('DNS and edge delays beyond the former 60-second limit recover before readiness', async () => {
  const timing = clock();
  let completed = false;
  await waitFor(async () => {
    if (timing.now() < 70000) throw new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'ENOTFOUND' }) });
    if (timing.now() < 85000) throw new Error('HTTP 530');
    completed = true;
    return sessionReady({ ok: true, sessionId: 'current' }, 'current');
  }, 180000, '외부 접속 실패', timing);
  assert.equal(completed, true);
  assert.ok(timing.now() > 60000 && timing.now() < 180000);
  assert.ok(timing.reports.some(report => report.reason.includes('ENOTFOUND')));
  assert.ok(timing.reports.some(report => report.reason.includes('HTTP 530')));
  assert.ok(timing.reports.length <= 7);
});

test('timeout retains the actual failure and respects its deadline', async () => {
  const timing = clock();
  const failure = new Error('HTTP 503');
  await assert.rejects(waitFor(() => { throw failure; }, 2000, '외부 접속 실패', timing), error => {
    assert.match(error.message, /외부 접속 실패\n마지막 확인: HTTP 503/);
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal(timing.now(), 2000);
});

test('unready or stale sessions cannot pass; websocket failures remain retryable', async () => {
  assert.throws(() => sessionReady({ ok: false, sessionId: 'current' }, 'current'), /준비/);
  assert.throws(() => sessionReady({ ok: true, sessionId: 'previous' }, 'current'), /일치/);
  const timing = clock();
  let attempts = 0;
  await waitFor(() => {
    sessionReady({ ok: true, sessionId: 'current' }, 'current');
    if (++attempts === 1) throw new Error('실시간 연결 대기');
    return true;
  }, 5000, '실시간 확인 실패', timing);
  assert.equal(attempts, 2);
});

test('stopped child processes and fatal failures stop retries immediately', async () => {
  const timing = clock();
  let checks = 0;
  await assert.rejects(waitFor(() => ++checks, 180000, '실패', {
    ...timing, beforeCheck() { throw new Error('앱이 종료됐습니다.'); },
  }), /앱이 종료/);
  assert.equal(checks, 0);
  await assert.rejects(waitFor(() => { throw Object.assign(new Error('fatal'), { fatal: true }); }, 180000, '실패', timing), /fatal/);
  assert.equal(timing.now(), 0);
});

test('network diagnostics distinguish DNS and connection timeouts', () => {
  assert.match(connectionError({ cause: { code: 'EAI_AGAIN' } }), /DNS/);
  assert.match(connectionError({ name: 'TimeoutError' }), /시간 초과/);
  assert.match(connectionError({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), /시간 초과/);
});

test('HTTP status survives a non-JSON edge error response', async () => {
  const server = http.createServer((_req, res) => { res.writeHead(530); res.end('<html>not ready</html>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    await assert.rejects(requestJson(`http://127.0.0.1:${server.address().port}`), /HTTP 530/);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
