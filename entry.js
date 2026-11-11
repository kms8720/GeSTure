const fingers = { thumb: '엄지', index: '검지', middle: '중지', ring: '약지', pinky: '소지' };
const status = document.querySelector('#status');
const retry = document.querySelector('#retry');
const choices = document.querySelector('#fingers');
let busy = false;
async function connect() {
  if (busy) return;
  busy = true; retry.disabled = true; choices.hidden = true;
  status.textContent = '전시 연결을 확인하고 있습니다.';
  try {
    const response = await fetch(`./endpoint.json?v=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error();
    const endpoint = await response.json();
    if (!endpoint.origin) { status.textContent = '전시를 준비하고 있습니다. 잠시 후 다시 연결해 주세요.'; return; }
    const url = new URL(endpoint.origin);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname) || url.origin !== endpoint.origin || Date.parse(endpoint.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(endpoint.expiresAt))) throw new Error();
    const health = await fetch(`${url.origin}/entry-health?v=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const state = await health.json();
    if (!health.ok || state.ok !== true || state.sessionId !== endpoint.sessionId) throw new Error();
    const finger = new URLSearchParams(location.search).get('finger');
    if (finger && Object.hasOwn(fingers, finger)) { location.replace(`${url.origin}/join?finger=${finger}`); return; }
    if (finger) { status.textContent = '올바른 손가락 QR로 다시 접속해 주세요.'; return; }
    status.textContent = '움직이고 싶은 손가락을 선택해 주세요.';
    choices.replaceChildren(...Object.entries(fingers).map(([key, label]) => {
      const a = document.createElement('a'); a.textContent = label; a.href = `${url.origin}/join?finger=${key}`; return a;
    }));
    choices.hidden = false;
  } catch { status.textContent = '작품 연결이 잠시 끊겼습니다. 다시 연결하거나 운영자에게 알려 주세요.'; }
  finally { busy = false; retry.disabled = false; }
}
retry.addEventListener('click', connect);
void connect();
