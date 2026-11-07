import '../server/environment.js';
import { POSE_CLASSES, createInitialHandState } from '../server/poseClasses.js';
import type { JamoSlot, WordCorrection } from '../server/wordCorrection.js';

type Recognition = {
  slots: JamoSlot[];
  slotsNeeded: number;
  correction: WordCorrection | null;
  correcting: boolean;
};

const port = Number(process.env.PORT ?? 3002);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 설정을 확인해 주세요.');
if (!process.env.OPERATOR_TOKEN) throw new Error('운영자 키가 없습니다. npm run setup을 먼저 실행해 주세요.');
// 운영자 키는 로컬 서버로만 전송한다. LAN 주소나 QR에는 넣지 않는다.
const origin = `http://127.0.0.1:${port}`;
const abort = new AbortController();
process.once('SIGINT', () => abort.abort());
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function request<T>(route: string, body?: unknown, cleanup = false): Promise<T>
{
  const response = await fetch(origin + route, {
    method: body === undefined ? 'GET' : 'POST',
    signal: cleanup ? AbortSignal.timeout(3000) : AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPERATOR_TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${route}: 요청 실패 (${response.status})`);
  return response.json() as Promise<T>;
}

const recognition = async () => (await request<{ recognitionState: Recognition }>('/recognition-state')).recognitionState;

async function waitFor(check: (state: Recognition) => boolean, timeout: number): Promise<Recognition>
{
  const started = Date.now();
  while (true)
  {
    abort.signal.throwIfAborted();
    const state = await recognition();
    if (check(state)) return state;
    if (Date.now() - started >= timeout) throw new Error('입력 확인 시간이 초과됐습니다. 휴대폰 드래그를 멈춘 뒤 다시 실행해 주세요.');
    await delay(100);
  }
}

let movedHand = false;
try
{
  await request('/health');
  const initial = await recognition();
  if (initial.correcting) throw new Error('이미 단어 생성 중입니다. 완료 후 다시 실행해 주세요.');
  console.log('단어 1개 시연을 시작합니다. 잠시 휴대폰 드래그를 멈춰 주세요.');
  console.log('실제 손 모양 입력 → 400ms 유지 인식 → 단어 생성 → 단어 구름 추가 순서로 진행합니다.');
  const recorded = new Set(initial.slots.map((slot) => slot.classId));
  const targets = POSE_CLASSES.filter((pose) => !recorded.has(pose.id)).slice(0, initial.slotsNeeded - initial.slots.length);
  for (let i = 0; i < targets.length; i++)
  {
    const pose = targets[i];
    movedHand = true;
    await request('/hand-state', pose.flexion);
    const isLast = i === targets.length - 1;
    const state = await waitFor((next) =>
      next.slots.some((slot) => slot.classId === pose.id) || next.correcting ||
      (isLast && next.slots.length === 0 && Boolean(next.correction?.slots.some((slot) => slot.classId === pose.id))), 5000);
    console.log(`손 모양 ${initial.slots.length + i + 1}/${initial.slotsNeeded}: ${pose.jamo.join('/')}`);
    if (state.correcting || (isLast && state.correction && state.slots.length === 0)) break;
  }
  console.log('로컬 모델이 단어를 생성하고 있습니다…');
  const completed = await waitFor((state) => !state.correcting && state.slots.length === 0 && Boolean(state.correction?.correctedWord), 25_000);
  const correction = completed.correction!;
  console.log(`완성: ${correction.correctedWord} (${correction.source === 'llm' ? '로컬 모델' : '단어장 대체'}, ${correction.elapsedMs}ms)`);
  console.log('단어 화면에서 구름에 추가된 단어와 약 10초 주기의 문장 전환을 확인해 주세요.');
}
catch (error)
{
  console.error(abort.signal.aborted ? '시연을 중단했습니다.' : `시연 중단: ${(error as Error).message}`);
  process.exitCode = 1;
}
finally
{
  if (movedHand)
  {
    try { await request('/hand-state', createInitialHandState(), true); }
    catch { console.error('손을 펴는 요청에 실패했습니다. 서버 연결을 확인해 주세요.'); process.exitCode = 1; }
  }
}
