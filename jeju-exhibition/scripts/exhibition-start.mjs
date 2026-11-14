import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { io } from 'socket.io-client';
import { createGateway } from './exhibition/gateway.mjs';
import { ENTRY, checkAuth, checkPages, getEndpoint, publish } from './exhibition/pages.mjs';
import { requestJson as json, sessionReady, waitFor as retryUntil } from './exhibition/readiness.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
try { loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const port = Number(process.env.PORT ?? 3002);
const gatewayPort = Number(process.env.TUNNEL_PORT ?? 3003);
const sessionId = randomUUID();
const data = path.join(root, 'data', 'exhibition-launcher');
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
const lock = path.join(data, 'running.json');
let locked = false, stopping = false, gateway, origin = '', published = false;
let appChild, tunnelChild;
const children = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function report(message) {
  console.log(message);
  fs.appendFileSync(path.join(data, 'launcher.log'), `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
}
function step(message) { report(`\n${message}`); }
function launch(command, args, name, env = process.env, onData) {
  const log = fs.openSync(path.join(data, `${name}.log`), 'a', 0o600);
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.on('error', () => { child.failed = true; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { fs.writeSync(log, chunk); onData?.(chunk.toString()); });
  child.on('close', () => fs.closeSync(log));
  return child;
}
function alive(child) { return child && !child.failed && child.exitCode === null && child.signalCode === null; }
async function waitFor(check, timeout, message) {
  return retryUntil(check, timeout, message, {
    beforeCheck() {
      if (stopping) throw new Error('종료 중');
      if (appChild && !alive(appChild)) throw new Error('앱이 종료됐습니다. data/exhibition-launcher/app.log를 확인하세요.');
      if (tunnelChild && !alive(tunnelChild)) throw new Error('터널이 종료됐습니다. 터미널을 닫고 전시 시작을 다시 실행하세요.');
    },
    onRetry: ({ elapsedMs, reason }) => report(`  연결 준비 대기 ${Math.round(elapsedMs / 1000)}초 / ${Math.round(timeout / 1000)}초 · ${reason}`),
  });
}
async function portFree(value) {
  await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', () => reject(new Error(`${value} 포트가 사용 중입니다. 이전 전시 프로그램을 정상 종료하세요.`))); s.listen(value, '127.0.0.1', () => s.close(resolve)); });
}
async function socketCheck() {
  return new Promise((resolve, reject) => {
    const socket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 7000 });
    const finish = error => { clearTimeout(timer); socket.disconnect(); error ? reject(error) : resolve(true); };
    const timer = setTimeout(() => finish(new Error('실시간 손 상태 수신 시간 초과')), 8000);
    socket.once('hand:state', () => finish());
    socket.once('connect_error', error => finish(new Error(`실시간 연결 대기: ${error.message}`)));
  });
}
async function cleanup() {
  if (stopping) return; stopping = true;
  step('전시 종료 중…');
  // Only clear the entrance if it still belongs to this run; never erase another machine's session.
  if (published) try {
    const current = await getEndpoint();
    if (current?.sessionId === sessionId) await publish({ origin: null, sessionId: null, expiresAt: null }, { expectedSessionId: sessionId });
  } catch { console.error('입구 대기 상태 갱신 실패. 접속 상태 검사로 관객 이동은 차단되며 다음 시작에서 다시 갱신합니다.'); }
  for (const child of [...children].reverse()) if (alive(child)) child.kill('SIGTERM');
  gateway?.close(); gateway?.closeAllConnections();
  await sleep(1500);
  for (const child of children) if (alive(child)) child.kill('SIGKILL');
  if (locked) fs.rmSync(lock, { force: true });
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => void cleanup().then(() => process.exit(0)));
try {
  if (process.platform !== 'darwin') throw new Error('이 시작 프로그램은 전시용 Mac mini에서 실행하세요.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) throw new Error('Node 22.18 이상을 설치하세요.');
  if (![port, gatewayPort].every(p => Number.isInteger(p) && p > 0 && p <= 65535) || port === gatewayPort) throw new Error('PORT와 TUNNEL_PORT는 서로 다른 유효한 포트여야 합니다.');
  try {
    const previous = JSON.parse(fs.readFileSync(lock, 'utf8'));
    let running = true; try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; }
    if (running) throw new Error('전시 시작 프로그램이 이미 실행 중입니다. 기존 터미널을 확인하세요.');
    fs.rmSync(lock);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, sessionId }), { flag: 'wx', mode: 0o600 }); locked = true;
  step('1/6 설치·인증·포트 확인');
  for (const command of ['cloudflared', 'gh', 'ollama', 'npm']) try { execFileSync('which', [command], { stdio: 'ignore' }); } catch { throw new Error(`${command} 설치가 필요합니다. HANDOFF 최초 준비를 확인하세요.`); }
  if (!process.env.OPERATOR_TOKEN) throw new Error('운영자 키가 없습니다. 최초 준비에서 npm run setup을 실행하세요.');
  await checkAuth(); await checkPages(); await portFree(port); await portFree(gatewayPort);
  const previous = await getEndpoint();
  if (previous?.origin && Date.parse(previous.expiresAt) > Date.now()) {
    let health; try { health = await json(`${previous.origin}/entry-health`); } catch {}
    if (health?.sessionId === previous.sessionId && health?.ok) throw new Error('다른 전시 세션이 연결되어 있습니다. 해당 Mac에서 먼저 종료하세요.');
  }
  // Existing cloudflared config can prevent Quick Tunnel creation. Do not rename user files automatically.
  for (const name of ['config.yml', 'config.yaml']) if (fs.existsSync(path.join(process.env.HOME, '.cloudflared', name))) throw new Error('기존 ~/.cloudflared/config 파일이 있습니다. HANDOFF의 임시 터널 설정 충돌 안내를 확인하세요.');
  step('2/6 화면 빌드·Ollama 준비');
  const buildEnv = { ...process.env, VITE_SOCKET_URL: '' };
  execFileSync('npm', ['run', 'build'], { cwd: root, env: buildEnv, stdio: 'inherit', timeout: 180000 });
  const ollamaUrl = new URL(process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434');
  if (!['localhost', '127.0.0.1'].includes(ollamaUrl.hostname)) throw new Error('시작 프로그램은 Mac mini의 로컬 Ollama만 지원합니다.');
  let tags; try { tags = await json(`${ollamaUrl.origin}/api/tags`); } catch {
    launch('ollama', ['serve'], 'ollama');
    await waitFor(async () => { tags = await json(`${ollamaUrl.origin}/api/tags`); return true; }, 30000, 'Ollama 실행 실패');
  }
  const model = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
  if (!tags.models?.some(entry => entry.name === model || entry.model === model)) throw new Error(`모델이 없습니다. 전시 전에 ollama pull ${model}을 실행하세요.`);
  console.log('모델 예열 중 (최대 2분)…');
  const warm = await fetch(`${ollamaUrl.origin}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: '안녕', stream: false, keep_alive: '8h', options: { num_predict: 1 } }), signal: AbortSignal.timeout(120000) });
  if (!warm.ok || (await warm.json()).error) throw new Error('모델 예열 실패. Ollama 로그와 Mac mini 메모리를 확인하세요.');
  step('3/6 관객 전용 게이트웨이·무료 터널 시작');
  gateway = createGateway({ port, sessionId, allowedOrigin: () => origin });
  await new Promise((resolve, reject) => { gateway.once('error', reject); gateway.listen(gatewayPort, '127.0.0.1', resolve); });
  let tunnelText = '';
  tunnelChild = launch('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${gatewayPort}`, '--no-autoupdate'], 'tunnel', process.env, text => {
    tunnelText = (tunnelText + text).slice(-16000);
    origin ||= tunnelText.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? '';
  });
  await waitFor(() => Boolean(origin), 60000, '터널 주소 발급 실패. 인터넷·방화벽을 확인하거나 사전 검증한 핫스팟으로 전환하세요.');
  step('4/6 앱 실행·외부 실시간 연결 확인 (주소 반영 대기 최대 3분)');
  report(`공개 주소: ${origin}`);
  appChild = launch(process.execPath, ['--import', 'tsx', 'server/index.ts'], 'app', { ...process.env,
    CONNECTION_MODE: 'internet', PUBLIC_ORIGIN: origin, JOIN_ENTRY_URL: ENTRY, PORT: String(port) });
  await waitFor(async () => (await json(`http://127.0.0.1:${port}/health`)).ok, 30000, '앱 시작 실패');
  await waitFor(async () => sessionReady(await json(`http://127.0.0.1:${gatewayPort}/entry-health`), sessionId), 15000, '로컬 관객 게이트웨이 확인 실패');
  await waitFor(async () => {
    sessionReady(await json(`${origin}/entry-health?v=${Date.now()}`), sessionId);
    return socketCheck();
  }, 180000, '외부 접속 대기 시간이 지났습니다. 아래 원인과 launcher.log·tunnel.log를 확인하세요.');
  step('5/6 고정 QR 입구 갱신·배포 확인 (최대 10분)');
  const endpoint = { origin, sessionId, expiresAt: new Date(Date.now() + 12 * 3600000).toISOString() };
  await publish(endpoint, { expectedSessionId: previous?.sessionId ?? null }); published = true;
  await waitFor(async () => (await json(`${ENTRY}endpoint.json?v=${Date.now()}`)).sessionId === sessionId, 600000, 'GitHub Pages 갱신 대기 시간이 지났습니다. GitHub 배포 상태를 확인하고 잠시 후 다시 실행하세요.');
  step(`6/6 공개 연결 준비 완료\n고정 입구: ${ENTRY}\n휴대폰 Wi-Fi를 끄고 QR 조종·단어·문장을 최종 확인하세요.\n종료: 이 창에서 Control+C. 이 창을 유지하세요.`);
  for (const route of ['/display/hand', '/display/word', '/join/qr']) spawn('open', [`http://localhost:${port}${route}`], { stdio: 'ignore' }).on('error', () => {});
  launch('caffeinate', ['-i', '-w', String(process.pid)], 'awake');
  let failures = 0;
  const expires = Date.parse(endpoint.expiresAt);
  while (!stopping) {
    await sleep(15000);
    if (!alive(appChild) || !alive(tunnelChild)) throw new Error('앱 또는 터널이 종료됐습니다. 전시 시작 파일을 다시 실행하세요.');
    if (Date.now() >= expires) throw new Error('12시간 전시 세션이 만료됐습니다. 전시 시작을 다시 실행하세요.');
    try { const h = await json(`${origin}/entry-health`); if (h.sessionId !== sessionId) throw new Error(); if (failures) console.log('외부 연결 복구됨'); failures = 0; }
    catch { failures++; if (failures === 2) console.error('외부 연결 끊김: 인터넷을 확인하세요. 기존 주소로 재연결을 기다립니다. 터널이 종료되면 시작 파일을 다시 실행하세요.'); }
  }
} catch (error) { if (!stopping) { report(`\n준비 실패: ${error.message}\n자세한 로그: ${data}\n문제 해결 후 전시 시작 파일을 다시 실행하세요.`); process.exitCode = 1; } }
finally { await cleanup(); }
