import '../server/environment.js';
import { io } from 'socket.io-client';

const origin = new URL(process.argv[2] ?? process.env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3002}`).origin;
const checks: { name: string; ok: boolean; detail?: string }[] = [];
for (const route of ['/health', '/network-info', '/join', '/join/qr', '/check', '/display/hand', '/display/word'])
{
  try
  {
    const response = await fetch(origin + route, { signal: AbortSignal.timeout(5000) });
    let ok = response.ok;
    if (route === '/health') ok = ok && (await response.json() as { ok?: boolean }).ok === true;
    if (route === '/network-info')
    {
      const info = await response.json() as { publicOrigin?: string; configured?: boolean; wifiSsid?: string };
      checks.push({ name: '참여 주소·Wi-Fi 안내 설정', ok: Boolean(info.configured && info.wifiSsid && info.publicOrigin === origin) });
    }
    checks.push({ name: route, ok });
    await response.body?.cancel().catch(() => undefined);
  }
  catch { checks.push({ name: route, ok: false, detail: '5초 안에 응답하지 않음' }); }
}
await new Promise<void>((resolve) =>
{
  const socket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 5000 });
  let finished = false;
  const finish = (ok: boolean): void =>
  {
    if (finished) return;
    finished = true;
    clearTimeout(timer); socket.disconnect(); checks.push({ name: '실시간 상태 수신', ok }); resolve();
  };
  const timer = setTimeout(() => finish(false), 5500);
  socket.once('recognition:state', () => finish(true));
  socket.once('connect_error', () => finish(false));
});
const localOnly = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
checks.push({ name: '관객용 LAN 주소로 검사', ok: !localOnly });
console.log(JSON.stringify({ origin, checks, note: '이 검사는 실행한 컴퓨터에서의 접속만 확인합니다. iPhone·Android 실기와 인터넷 차단 검증은 별도로 필요합니다.' }, null, 2));
if (checks.some((check) => !check.ok)) process.exitCode = 1;
