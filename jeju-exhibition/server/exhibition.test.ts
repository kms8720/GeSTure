import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { io, Socket } from 'socket.io-client';
import { FINGERS, POSE_CLASSES } from './poseClasses.js';
import type { ParticipantState, ParticipationSummary } from './participantSessions.js';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean | Promise<boolean>, timeout = 4000): Promise<void>
{
  const startedAt = Date.now();
  while (!await predicate())
  {
    if (Date.now() - startedAt > timeout) throw new Error('조건을 기다리는 시간 초과');
    await delay(25);
  }
}
const key = 'test-operator-access-key';
let appProcess: ChildProcess;
let url = '';
let port = 0;
let mockPort = 0;
let modelDelay = 10;
let modelWord = '사랑';
let sockets: Socket[] = [];
const states = new Map<Socket, ParticipantState>();
const summaries = new Map<Socket, ParticipationSummary>();
const model = createServer((request, response) =>
{
  request.resume(); request.on('end', () =>
  {
    const word = modelWord;
    setTimeout(() => response.end(JSON.stringify({ message: { content: JSON.stringify({ correctedWord: word }) } })), modelDelay);
  });
});
const post = (route: string, body: unknown = {}, authorized = true) => fetch(url + route, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify(body)
});
const state = async () => (await (await fetch(url + '/recognition-state')).json()).recognitionState;
const hand = async () => (await (await fetch(url + '/hand-state')).json()).handState;

async function startApp(operatorKey = key): Promise<void>
{
  appProcess = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), SLOTS_PER_WORD: '6', POSE_HOLD_MS: '400',
      OPERATOR_TOKEN: operatorKey, PUBLIC_ORIGIN: `http://192.168.50.10:${port}`, WIFI_SSID: 'GeSTure-test', WIFI_PASSWORD: 'guest-test',
      EXHIBITION_STRICT: '1', OLLAMA_URL: `http://127.0.0.1:${mockPort}`, OLLAMA_TIMEOUT_MS: '700', WORD_DEADLINE_MS: '700' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = ''; appProcess.stderr?.on('data', (chunk) => { errors += chunk; });
  await until(async () =>
  {
    if (appProcess.exitCode !== null) throw new Error(errors || '서버 시작 실패');
    try { return (await fetch(url + '/health')).ok; } catch { return false; }
  });
}

async function stopApp(): Promise<void>
{
  if (appProcess.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => appProcess.once('exit', () => resolve()));
  appProcess.kill('SIGTERM'); await exited;
}

async function connectParticipant(index: number, reconnect = false): Promise<Socket>
{
  const socket = io(url, { autoConnect: false, transports: ['websocket'], reconnection: reconnect, reconnectionDelay: 100 });
  sockets.push(socket);
  socket.on('participant:state', (next) => states.set(socket, next));
  socket.on('participation:summary', (next) => summaries.set(socket, next));
  socket.on('connect', () => socket.emit('participant:join', { token: `integration-token-${index}` }));
  socket.connect(); await until(() => states.has(socket)); return socket;
}

before(async () =>
{
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  mockPort = (model.address() as { port: number }).port;
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  url = `http://127.0.0.1:${port}`; await startApp();
});
beforeEach(async () =>
{
  modelDelay = 10; modelWord = '사랑';
  await post('/hand-state', Object.fromEntries(FINGERS.map((finger) => [finger, 100])));
  await post('/recognition/reset');
});
afterEach(async () =>
{
  for (const socket of sockets) if (socket.connected) socket.emit('participant:leave');
  await delay(75); for (const socket of sockets) socket.disconnect();
  sockets = []; states.clear(); summaries.clear();
  for (const finger of FINGERS) await post(`/participants/${finger}/release`);
  await post('/recognition/reset');
});
after(async () =>
{
  for (const socket of sockets) socket.disconnect();
  await stopApp(); model.closeAllConnections();
  await new Promise<void>((resolve) => model.close(() => resolve()));
});

test('all mutation routes require an operator key while public participation stays open', async () =>
{
  for (const route of ['/hand-state', '/recognition/reset', '/recognition/finalize',
    '/recognition/hide-word', '/participants/thumb/release', '/word-correction', '/operator/session'])
  {
    assert.equal((await post(route, {}, false)).status, 401);
  }
  assert.equal((await post('/operator/session')).status, 200);
  const participant = await connectParticipant(0);
  assert.equal(states.get(participant)?.finger, 'thumb');
});

test('missing operator configuration keeps mutations locked instead of accepting an empty key', async () =>
{
  await stopApp(); await startApp('');
  try { assert.equal((await post('/recognition/reset')).status, 503); }
  finally { await stopApp(); await startApp(); }
});

test('one pose is recorded after holding without any subsequent input and is not repeated', async () =>
{
  await post('/hand-state', POSE_CLASSES[0].flexion);
  await until(async () => (await state()).slots.length === 1);
  assert.equal((await state()).slots[0].classId, POSE_CLASSES[0].id);
  await delay(650); assert.equal((await state()).slots.length, 1);
});

test('three complete cycles do not carry an old pose or word into the next cycle', async () =>
{
  const initialWords = (await state()).words.length;
  for (let cycle = 0; cycle < 3; cycle++)
  {
    for (let i = 0; i < 6; i++)
    {
      await post('/hand-state', POSE_CLASSES[i].flexion);
      if (i < 5) await until(async () => (await state()).slots.length === i + 1);
      else await until(async () => (await state()).words.length === initialWords + cycle + 1);
      if (i === 0) assert.equal((await state()).correction, null);
    }
    const result = await state();
    assert.equal(result.correction.slots.length, 6);
    assert.equal(result.slots.length, 0);
    await delay(650); assert.equal((await state()).slots.length, 0);
  }
});

test('five sockets control only their assigned fingers and three waiters succeed in order', async () =>
{
  const clients: Socket[] = [];
  for (let i = 0; i < 8; i++) clients.push(await connectParticipant(i));
  assert.deepEqual(clients.slice(0, 5).map((client) => states.get(client)?.finger), [...FINGERS]);
  assert.deepEqual(clients.slice(5).map((client) => states.get(client)?.queuePosition), [1, 2, 3]);
  clients[0].emit('finger:update', { finger: 'pinky', value: 0 });
  await until(async () => (await hand()).thumb === 0);
  assert.equal((await hand()).pinky, 100);
  let participantError = '';
  clients[0].once('participant:error', (error) => { participantError = error.message; });
  clients[0].emit('participant:join', { token: 'different-integration-token' });
  await until(() => participantError.length > 0);
  assert.equal(summaries.get(clients[1])?.occupiedCount, 5);
  for (let i = 0; i < 3; i++)
  {
    clients[i].emit('participant:leave');
    await until(() => states.get(clients[5 + i])?.finger === FINGERS[i]);
    assert.equal((await hand())[FINGERS[i]], 100);
  }
  assert.equal(summaries.get(clients[7])?.waitingCount, 0);
});

test('a second tab takes over the same token and the old tab cannot control or release it', async () =>
{
  const old = await connectParticipant(1);
  const replacement = await connectParticipant(1);
  await until(() => states.get(old)?.status === 'released');
  old.emit('finger:update', { value: 0 }); old.emit('participant:leave');
  await delay(150); assert.equal((await hand()).thumb, 100);
  replacement.emit('finger:update', { value: 25 });
  await until(async () => (await hand()).thumb === 25);
  old.disconnect(); await delay(150);
  assert.equal(summaries.get(replacement)?.connectedCount, 1);
});

test('a temporary disconnect reclaims the same slot inside the grace period', async () =>
{
  const first = await connectParticipant(2);
  first.emit('finger:update', { value: 25 }); await until(async () => (await hand()).thumb === 25);
  first.disconnect(); await delay(150);
  const restored = await connectParticipant(2);
  assert.equal(states.get(restored)?.finger, 'thumb'); assert.equal((await hand()).thumb, 25);
});

test('a pose is not recorded after the last participating socket disconnects', async () =>
{
  const client = await connectParticipant(0);
  client.emit('finger:update', { value: 0 });
  await until(async () => (await hand()).thumb === 0);
  client.disconnect(); await delay(700);
  assert.equal((await state()).slots.length, 0);
});

test('closing a read-only monitor does not cancel an operator pose', async () =>
{
  const observer = io(url, { transports: ['websocket'], reconnection: false });
  await new Promise<void>((resolve) => observer.once('connect', resolve));
  try
  {
    await post('/hand-state', POSE_CLASSES[0].flexion);
    observer.disconnect();
    await until(async () => (await state()).slots.length === 1);
  }
  finally { observer.disconnect(); }
});

test('real expiry resets the finger and promotes a waiting participant', async () =>
{
  const clients: Socket[] = [];
  for (let i = 0; i < 6; i++) clients.push(await connectParticipant(i));
  clients[0].emit('finger:update', { value: 0 }); await until(async () => (await hand()).thumb === 0);
  clients[0].disconnect();
  await delay(600); assert.equal(states.get(clients[5])?.status, 'waiting');
  await until(() => states.get(clients[5])?.finger === 'thumb', 17000);
  assert.equal((await hand()).thumb, 100);
});

test('a reset or hide during generation cancels late results and repeated finalize is rejected', async () =>
{
  modelDelay = 500;
  await post('/hand-state', POSE_CLASSES[0].flexion);
  await until(async () => (await state()).slots.length === 1);
  const first = post('/recognition/finalize');
  await until(async () => (await state()).correcting);
  assert.equal((await post('/recognition/finalize')).status, 409);
  const before = (await state()).words.length;
  await post('/recognition/hide-word'); await first; await delay(700);
  const result = await state();
  assert.equal(result.correcting, false); assert.equal(result.correction, null);
  assert.equal(result.words.length, before); assert.equal(result.slots.length, 0);
});

test('unsafe model output is replaced and an operator can remove the current word from all screens', async () =>
{
  modelWord = '병신';
  await post('/hand-state', POSE_CLASSES[0].flexion);
  await until(async () => (await state()).slots.length === 1);
  await post('/recognition/finalize');
  const result = await state(); assert.equal(result.correction.source, 'vocabulary');
  const word = result.correction.correctedWord;
  assert.notEqual(word, '병신');
  await post('/recognition/hide-word');
  const hidden = await state(); assert.equal(hidden.correction, null); assert.ok(!hidden.words.includes(word));
});

test('rapid mobile updates are broadcast at the recognition tick rate', async () =>
{
  const client = await connectParticipant(0); let broadcasts = 0;
  client.on('recognition:state', () => broadcasts++);
  for (let i = 0; i < 50; i++) client.emit('finger:update', { value: i });
  await delay(600); assert.ok(broadcasts <= 8, `과도한 업데이트: ${broadcasts}`);
  assert.equal((await hand()).thumb, 49);
});

test('server restart makes five participants rejoin without duplicating finger ownership', async () =>
{
  const clients: Socket[] = [];
  for (let i = 0; i < 8; i++) clients.push(await connectParticipant(i, true));
  await stopApp(); await until(() => clients.every((client) => !client.connected));
  states.clear(); await startApp();
  await until(() => clients.every((client) => client.connected && states.has(client)), 8000);
  const assigned = clients.map((client) => states.get(client)).filter((entry) => entry?.status === 'assigned');
  assert.equal(assigned.length, 5); assert.equal(new Set(assigned.map((entry) => entry?.finger)).size, 5);
  assert.equal(clients.filter((client) => states.get(client)?.status === 'waiting').length, 3);
});

test('network metadata honors the configured address and never discloses the operator key', async () =>
{
  const result = await (await fetch(url + '/network-info')).json();
  assert.equal(result.joinUrl, `http://192.168.50.10:${port}/join`);
  assert.equal(result.wifiSsid, 'GeSTure-test'); assert.equal(result.configured, true);
  assert.ok(!JSON.stringify(result).includes(key));
  assert.equal((await post('/hand-state', { thumb: 'NaN' })).status, 400);
});
