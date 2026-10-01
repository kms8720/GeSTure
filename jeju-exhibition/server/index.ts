import './environment.js';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';

import {
  FINGERS,
  Finger,
  HandState,
  POSE_CLASSES,
  createInitialHandState
} from './poseClasses.js';
import {
  PoseRecognition,
  PoseStabilizer,
  getPoseClass,
  rankPoses,
  recognizePose
} from './poseRecognizer.js';
import {
  ParticipantSessions,
  ReleaseResult
} from './participantSessions.js';
import { JamoSlot, WordCorrection, correctWord, matchVocabulary, warmUpOllama } from './wordCorrection.js';
import { operatorAuth } from './operatorAuth.js';
import { getLanAddresses, networkInfo, validatePublicOrigin } from './network.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3002);
const SLOTS_PER_WORD = Number(process.env.SLOTS_PER_WORD ?? 6);
const POSE_HOLD_MS = Number(process.env.POSE_HOLD_MS ?? 400);
const MAX_WORD_HISTORY = 24;
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ? validatePublicOrigin(process.env.PUBLIC_ORIGIN) : undefined;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535 ||
    !Number.isInteger(SLOTS_PER_WORD) || SLOTS_PER_WORD < 1 || SLOTS_PER_WORD > POSE_CLASSES.length ||
    !Number.isFinite(POSE_HOLD_MS) || POSE_HOLD_MS < 0)
{
  throw new Error('PORT / SLOTS_PER_WORD / POSE_HOLD_MS 설정값을 확인해 주세요.');
}

type RecognitionState = {
  current: PoseRecognition;
  /** 지금까지 모인 손 모양 슬롯들. 각 슬롯은 자모 후보 집합이다 */
  slots: JamoSlot[];
  slotsNeeded: number;
  correction: WordCorrection | null;
  /** 전시 화면에 쌓이는 단어들 */
  words: string[];
  correcting: boolean;
  note: string;
  updatedAt: string;
};

const handState: HandState = createInitialHandState();
const stabilizer = new PoseStabilizer(POSE_HOLD_MS);

const recognitionState: RecognitionState = {
  current: recognizePose(handState),
  slots: [],
  slotsNeeded: SLOTS_PER_WORD,
  correction: null,
  words: [],
  correcting: false,
  note: '첫 손 모양을 기다리는 중',
  updatedAt: new Date().toISOString()
};

/**
 * reset과 진행 중인 LLM 호출이 겹치면 이미 버려진 입력의 결과가 새 상태에 덮어써진다.
 * ACC 버전은 이 경합이 열려 있다(index.ts:179-184 가 correctionInFlight 를 그냥 false 로 되돌린다).
 * 세대 번호를 두고, 응답이 돌아왔을 때 세대가 바뀌었으면 결과를 버린다.
 */
let generation = 0;
let recordingEnabled = false;
let activeCorrection: AbortController | null = null;
let lastBroadcast = '';

const participants = new ParticipantSessions();

function isFinger(value: unknown): value is Finger
{
  return typeof value === 'string' && (FINGERS as readonly string[]).includes(value);
}

function clampFingerValue(value: unknown): number | null
{
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
}

function isParticipantToken(value: unknown): value is string
{
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(express.json({ limit: '16kb' }));
const requireOperator = operatorAuth(process.env.OPERATOR_TOKEN);
app.use((request, response, next) =>
{
  if (request.method === 'POST') requireOperator(request, response, next);
  else next();
});
app.post('/operator/session', (_request, response) => response.json({ ok: true }));

app.get('/health', (_request, response) =>
{
  response.json({ ok: true, port: PORT, poseClasses: POSE_CLASSES.length });
});

app.get('/network-info', (request, response) =>
{
  response.setHeader('Cache-Control', 'no-store');
  response.json({ ok: true, ...networkInfo(PORT, PUBLIC_ORIGIN, request.hostname) });
});

app.get('/pose-classes', (_request, response) =>
{
  response.json({ ok: true, count: POSE_CLASSES.length, classes: POSE_CLASSES });
});

app.get('/hand-state', (_request, response) =>
{
  response.json({ ok: true, handState, ranked: rankPoses(handState).slice(0, 3) });
});

app.post('/hand-state', (request, response) =>
{
  const payload = request.body as Partial<HandState>;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
  {
    response.status(400).json({ ok: false, error: '손가락 값이 필요합니다.' });
    return;
  }
  const updates: Partial<HandState> = {};
  for (const finger of FINGERS)
  {
    if (payload[finger] === undefined) continue;
    const value = clampFingerValue(payload[finger]);
    if (value === null)
    {
      response.status(400).json({ ok: false, error: '손가락 값은 유한한 숫자여야 합니다.' });
      return;
    }
    updates[finger] = value;
  }
  FINGERS.forEach((finger) =>
  {
    if (updates[finger] !== undefined) updateFinger(finger, updates[finger]!);
  });
  response.json({ ok: true, handState, recognitionState });
});

app.get('/recognition-state', (_request, response) =>
{
  response.json({ ok: true, recognitionState });
});

app.post('/recognition/reset', (_request, response) =>
{
  resetRecognition();
  broadcast();
  response.json({ ok: true, recognitionState });
});

app.post('/recognition/hide-word', (_request, response) =>
{
  const word = recognitionState.correction?.correctedWord;
  if (word) recognitionState.words = recognitionState.words.filter((entry) => entry !== word);
  resetRecognition();
  broadcast();
  response.json({ ok: true, recognitionState });
});

/** 현재 슬롯을 강제로 확정한다. 관객이 6개를 다 채우지 않고 떠났을 때 운영자가 쓴다 */
app.post('/recognition/finalize', async (_request, response) =>
{
  if (recognitionState.correcting)
  {
    response.status(409).json({ ok: false, error: '이미 단어를 만들고 있습니다.' });
    return;
  }
  if (recognitionState.slots.length === 0)
  {
    response.status(400).json({ ok: false, error: '확정할 손 모양이 없다' });
    return;
  }

  await runCorrection(recognitionState.slots.slice());
  response.json({ ok: true, recognitionState });
});

app.post('/participants/:finger/release', (request, response) =>
{
  if (!isFinger(request.params.finger))
  {
    response.status(400).json({ ok: false, error: 'unknown finger' });
    return;
  }

  const result = participants.releaseFinger(request.params.finger);
  applyParticipantRelease(result);
  response.json({ ok: true, controllerState: participants.getControllerState() });
});

app.post('/word-correction', async (request, response) =>
{
  const payload = request.body as { slots?: unknown } | null;
  if (!Array.isArray(payload?.slots) || payload.slots.length > POSE_CLASSES.length ||
      payload.slots.some((entry) => !entry || !Array.isArray(entry.candidates) ||
        entry.candidates.length === 0 || entry.candidates.length > 31 ||
        entry.candidates.some((candidate: unknown) => typeof candidate !== 'string' || !/^[ㄱ-ㅎㅏ-ㅣ]$/.test(candidate))))
  {
    response.status(400).json({ ok: false, error: '유효한 자모 후보 슬롯이 필요합니다.' });
    return;
  }
  const slots = Array.isArray(payload.slots)
    ? payload.slots
        .map((entry) =>
        {
          const slot = entry as Partial<JamoSlot>;
          const candidates = Array.isArray(slot.candidates) ? slot.candidates.map(String) : [];
          return { classId: String(slot.classId ?? 'manual'), candidates };
        })
        .filter((slot) => slot.candidates.length > 0)
    : [];

  if (slots.length === 0)
  {
    response.status(400).json({ ok: false, error: 'slots is required' });
    return;
  }

  response.json({ ok: true, correction: await correctWord(slots) });
});

app.get('/vocabulary-match', (request, response) =>
{
  const raw = String(request.query.slots ?? '');
  const slots = raw
    .split('|')
    .filter(Boolean)
    .map((group, index) => ({ classId: `q${index}`, candidates: Array.from(group) }));

  if (slots.length === 0)
  {
    response.status(400).json({ ok: false, error: 'slots query is required, e.g. ?slots=ㄱㄴㅏ|ㅁ|ㅂ' });
    return;
  }

  response.json({ ok: true, matches: matchVocabulary(slots, 10) });
});

io.on('connection', (socket) =>
{
  socket.emit('hand:state', handState);
  socket.emit('controller:state', participants.getControllerState());
  socket.emit('participation:summary', participants.getSummary());
  socket.emit('recognition:state', recognitionState);
  socket.emit('pose:classes', POSE_CLASSES);

  socket.on('participant:join', (payload: { token?: unknown }) =>
  {
    if (!isParticipantToken(payload?.token))
    {
      socket.emit('participant:error', { message: '참여 세션을 만들 수 없다. 페이지를 새로고침해 주세요.' });
      return;
    }

    expireParticipants();
    let result;
    try
    {
      result = participants.join(payload.token, socket.id);
    }
    catch (error)
    {
      socket.emit('participant:error', { message: (error as Error).message });
      return;
    }
    socket.data.participantToken = payload.token;

    if (result.replacedSocketId)
    {
      const replacedSocket = io.sockets.sockets.get(result.replacedSocketId);
      if (replacedSocket)
      {
        replacedSocket.data.participantToken = undefined;
        replacedSocket.emit('participant:state', {
          status: 'released',
          finger: null,
          queuePosition: null,
          summary: participants.getSummary()
        });
      }
    }

    broadcastParticipation();
    socket.emit('hand:state', handState);
  });

  socket.on('finger:update', (payload: { value?: unknown }) =>
  {
    const token = socket.data.participantToken;
    if (!isParticipantToken(token))
    {
      return;
    }

    const finger = participants.getAssignedFinger(token, socket.id);
    if (!finger)
    {
      return;
    }

    const value = clampFingerValue(payload?.value);
    if (value !== null) updateFinger(finger, value);
  });

  socket.on('participant:leave', () =>
  {
    const token = socket.data.participantToken;
    if (!isParticipantToken(token))
    {
      return;
    }

    socket.data.participantToken = undefined;
    const result = participants.release(token);
    applyParticipantRelease(result);
    socket.emit('participant:state', participants.getState(token));
  });

  socket.on('disconnect', () =>
  {
    const previousCount = participants.getSummary().connectedCount;
    participants.disconnect(socket.id);
    if (previousCount > 0 && participants.getSummary().connectedCount === 0) suspendRecording();
    broadcastParticipation();
  });
});

function broadcastParticipation(): void
{
  io.emit('controller:state', participants.getControllerState());
  io.emit('participation:summary', participants.getSummary());

  io.sockets.sockets.forEach((connectedSocket) =>
  {
    const token = connectedSocket.data.participantToken;
    if (isParticipantToken(token))
    {
      connectedSocket.emit('participant:state', participants.getState(token));
    }
  });
}

function suspendRecording(): void
{
  recordingEnabled = false;
  stabilizer.reset();
}

function updateFinger(finger: Finger, value: number): void
{
  // 서버에 의한 자리 반환과 단어 완성은 입력이 아니다. 다음 관객의 실제 조작으로 재개한다.
  // 현재 선택된 단계 버튼을 다시 눌러도 명시적 입력이다. 값 비교 전에 기록을 재개한다.
  if (!recognitionState.correcting) recordingEnabled = true;
  if (handState[finger] === value) return;
  handState[finger] = value;
}

function applyParticipantRelease(result: ReleaseResult): void
{
  if (result.releasedFinger)
  {
    handState[result.releasedFinger] = 100;
    suspendRecording();
  }
  broadcastParticipation();
}

function expireParticipants(): void
{
  const expired = participants.expire();
  if (expired.length === 0)
  {
    return;
  }

  expired.forEach((result) =>
  {
    if (result.releasedFinger)
    {
      handState[result.releasedFinger] = 100;
    }
  });
  suspendRecording();
  broadcastParticipation();
}
const participantExpiryTimer = setInterval(expireParticipants, 500);
participantExpiryTimer.unref();

function broadcast(): void
{
  const serialized = JSON.stringify({ handState, ...recognitionState, updatedAt: undefined });
  if (serialized === lastBroadcast) return;
  lastBroadcast = serialized;
  recognitionState.updatedAt = new Date().toISOString();
  io.emit('hand:state', handState);
  io.emit('recognition:state', recognitionState);
}

/**
 * 100ms마다 평가한다. 입력 이벤트는 손 상태 갱신만 한다.
 * 인식 -> 안정화 -> 슬롯 누적 -> 슬롯이 다 차면 단어 보정.
 */
function advance(): void
{
  const recognition = recognizePose(handState);
  recognitionState.current = recognition;

  if (recognitionState.correcting)
  {
    recognitionState.note = '단어를 만드는 중';
    broadcast();
    return;
  }

  if (!recordingEnabled)
  {
    broadcast();
    return;
  }

  const committed = stabilizer.update(recognition, Date.now());

  if (committed === null)
  {
    if (recognition.status === 'rest')
    {
      recognitionState.note = '다섯 손가락이 모두 펴진 rest 상태다. 자모를 넣지 않는다';
    }
    else
    {
      const remaining = recognitionState.slotsNeeded - recognitionState.slots.length;
      recognitionState.note = stabilizer.committed === recognition.classId
        ? `손 모양 ${recognitionState.slots.length}개 기록. ${remaining}개 더 모으면 단어가 된다`
        : `손 모양을 ${POSE_HOLD_MS}ms 유지하면 기록된다. ${remaining}개 남음`;
    }
    broadcast();
    return;
  }

  if (recognitionState.slots.some((slot) => slot.classId === committed))
  {
    recognitionState.note = '이 손 모양은 이미 이번 단어에 들어가 있다';
    broadcast();
    return;
  }

  const poseClass = getPoseClass(committed);
  if (poseClass === undefined)
  {
    broadcast();
    return;
  }

  recognitionState.correction = null;
  recognitionState.slots.push({ classId: poseClass.id, candidates: poseClass.jamo });

  if (recognitionState.slots.length >= recognitionState.slotsNeeded)
  {
    void runCorrection(recognitionState.slots.slice());
    return;
  }

  const remaining = recognitionState.slotsNeeded - recognitionState.slots.length;
  recognitionState.note = `손 모양 ${recognitionState.slots.length}개 기록. ${remaining}개 더 모으면 단어가 된다`;
  broadcast();
}

async function runCorrection(slots: JamoSlot[]): Promise<void>
{
  if (recognitionState.correcting) return;
  const startedGeneration = generation;
  const controller = new AbortController();
  activeCorrection = controller;
  suspendRecording();

  recognitionState.correcting = true;
  recognitionState.slots = [];
  recognitionState.note = '모인 손 모양으로 단어를 만드는 중';
  broadcast();

  let correction: WordCorrection | null = null;
  try
  {
    correction = await correctWord(slots, { signal: controller.signal });
  }
  finally
  {
    // reset이 끼어들었다면 이 결과는 이미 버려진 입력의 것이다
    if (startedGeneration === generation)
    {
      recognitionState.correcting = false;
      activeCorrection = null;

      if (correction !== null)
      {
        recognitionState.correction = correction;
        if (correction.correctedWord)
        {
          recognitionState.words.push(correction.correctedWord);
          if (recognitionState.words.length > MAX_WORD_HISTORY)
          {
            recognitionState.words.shift();
          }
        }
        recognitionState.note = correction.note || '단어를 만들었다';
      }

      suspendRecording();
      broadcast();
    }
  }
}

function resetRecognition(): void
{
  generation += 1;
  activeCorrection?.abort();
  activeCorrection = null;
  suspendRecording();
  recognitionState.current = recognizePose(handState);
  recognitionState.slots = [];
  recognitionState.correction = null;
  recognitionState.correcting = false;
  recognitionState.note = '초기화했다. 첫 손 모양을 기다리는 중';
}

const recognitionTimer = setInterval(advance, 100);
recognitionTimer.unref();

const distPath = path.resolve(__dirname, '../dist');

if (fs.existsSync(distPath))
{
  app.use(express.static(distPath));
  app.use((_request, response) =>
  {
    response.sendFile(path.join(distPath, 'index.html'));
  });
}

httpServer.listen(PORT, '0.0.0.0', () =>
{
  const addresses = getLanAddresses();
  console.log(`제주 전시 서버: http://0.0.0.0:${PORT}`);
  console.log(`포즈 클래스 ${POSE_CLASSES.length}개, 슬롯 ${SLOTS_PER_WORD}개마다 단어 생성`);
  if (!process.env.OPERATOR_TOKEN) console.warn('OPERATOR_TOKEN 미설정: 운영자 변경 기능은 잠겨 있습니다. npm run setup을 실행해 주세요.');
  addresses.forEach((address) =>
  {
    console.log(`  손 화면 (세로)  http://${address}:${PORT}/display/hand`);
    console.log(`  단어 화면       http://${address}:${PORT}/display/word`);
    console.log(`  관객 QR 주소     http://${address}:${PORT}/join`);
    console.log(`  QR 안내 화면     http://${address}:${PORT}/join/qr`);
    console.log(`  운영 모니터     http://${address}:${PORT}/monitor`);
  });

  // 예열하지 않으면 첫 관객의 단어가 거의 확실히 단어장 대체 경로로 떨어진다
  console.log('Ollama 예열 중...');
  void warmUpOllama().then((result) =>
  {
    console.log(`Ollama ${result.ok ? '준비됨' : '사용 불가'} (${result.elapsedMs}ms) — ${result.detail}`);
  });
});
