const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function connectionError(error) {
  const code = error?.cause?.code ?? error?.code;
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return `주소 DNS 조회 대기 (${code})`;
  if (error?.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return '접속 응답 시간 초과';
  return [error?.message ?? '연결 준비 중', typeof code === 'string' ? code : ''].filter(Boolean).join(' · ');
}

export async function requestJson(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function sessionReady(state, sessionId) {
  if (state?.ok !== true) throw new Error('관객 게이트웨이가 아직 준비되지 않았습니다.');
  if (state.sessionId !== sessionId) throw new Error('공개 주소의 전시 세션이 아직 일치하지 않습니다.');
  return true;
}

export async function waitFor(check, timeout, message, {
  beforeCheck = () => {}, onRetry = () => {}, now = Date.now, sleep = pause,
  retryMs = 1500, reportIntervalMs = 15000,
} = {}) {
  const start = now(), end = start + timeout;
  let lastError, nextReport = start;
  while (now() < end) {
    beforeCheck();
    try {
      if (await check()) return;
      lastError = new Error('아직 준비되지 않았습니다.');
    } catch (error) {
      if (error.fatal) throw error;
      lastError = error;
    }
    if (now() >= nextReport) {
      onRetry({ elapsedMs: now() - start, reason: connectionError(lastError) });
      nextReport = now() + reportIntervalMs;
    }
    const remaining = end - now();
    if (remaining > 0) await sleep(Math.min(retryMs, remaining));
  }
  throw new Error(`${message}\n마지막 확인: ${connectionError(lastError)}`, { cause: lastError });
}
