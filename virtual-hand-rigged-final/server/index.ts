import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  FINGERS,
  Finger,
  HandState,
  correctWord,
  createInitialHandState,
  generateBinaryJamoSamples,
  predictJamo
} from './binaryJamo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3001);

type ControllerState = Record<Finger, boolean>;
type VirtualSkeletonPoint = [number, number, number];
type VirtualSkeleton = {
  source: 'virtual-hand-rigged-final';
  handedness: 'Right' | 'Left' | 'Unknown';
  points: VirtualSkeletonPoint[];
  timestamp: string;
};
type RecognitionState = {
  current: ReturnType<typeof predictJamo>;
  tokens: string[];
  rawJamo: string;
  composedText: string;
  correctedWord: string;
  correctedWords: string[];
  candidates: string[];
  finalized: boolean;
  note: string;
  samplesPerLabel: number;
  updatedAt: string;
};

const handState: HandState = createInitialHandState();
const trainingSamples = generateBinaryJamoSamples();
const recognitionState: RecognitionState = createRecognitionState();

let lastAppendedJamo: string | null = null;

const controllerSockets: Record<Finger, Set<string>> = {
  thumb: new Set(),
  index: new Set(),
  middle: new Set(),
  ring: new Set(),
  pinky: new Set()
};

let latestVirtualSkeleton: VirtualSkeleton | null = null;

function isFinger(value: unknown): value is Finger
{
  return typeof value === 'string' && FINGERS.includes(value as Finger);
}

function clampFingerValue(value: unknown): number
{
  const numericValue = Number(value);

  if (Number.isNaN(numericValue))
  {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numericValue)));
}

function getControllerState(): ControllerState
{
  return {
    thumb: controllerSockets.thumb.size > 0,
    index: controllerSockets.index.size > 0,
    middle: controllerSockets.middle.size > 0,
    ring: controllerSockets.ring.size > 0,
    pinky: controllerSockets.pinky.size > 0
  };
}

function getConnectedControllerCount(): number
{
  return FINGERS.reduce((total, finger) => total + controllerSockets[finger].size, 0);
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.json());

app.get('/health', (_request, response) =>
{
  response.json({ ok: true });
});

app.get('/hand-state', (_request, response) =>
{
  response.json(handState);
});

app.post('/hand-state', async (request, response) =>
{
  const payload = request.body as Partial<HandState>;
  FINGERS.forEach((finger) =>
  {
    if (payload[finger] !== undefined)
    {
      handState[finger] = clampFingerValue(payload[finger]);
    }
  });

  await updateRecognitionState();
  io.emit('hand:state', handState);
  io.emit('recognition:state', recognitionState);
  response.json({ ok: true, handState, recognitionState });
});

app.get('/virtual-skeleton', (_request, response) =>
{
  if (latestVirtualSkeleton === null)
  {
    response.status(404).json({ ok: false, error: 'virtual skeleton is not available yet' });
    return;
  }

  response.json({ ok: true, skeleton: latestVirtualSkeleton });
});

app.get('/recognition-state', (_request, response) =>
{
  response.json({ ok: true, recognitionState });
});

app.post('/recognition/reset', (_request, response) =>
{
  resetRecognitionState();
  io.emit('recognition:state', recognitionState);
  response.json({ ok: true, recognitionState });
});

app.post('/word-correction', async (request, response) =>
{
  const payload = request.body as { tokens?: unknown; rawJamo?: unknown };
  const tokens = Array.isArray(payload.tokens)
    ? payload.tokens.map((token) => String(token))
    : String(payload.rawJamo ?? '').split('');

  if (tokens.length === 0)
  {
    response.status(400).json({ ok: false, error: 'tokens or rawJamo is required' });
    return;
  }

  const correction = await correctWord(tokens);
  response.json({ ok: true, correction });
});

app.get('/training-samples', (_request, response) =>
{
  response.json({
    ok: true,
    count: trainingSamples.length,
    samplesPerLabel: trainingSamples.length / 31,
    labels: Array.from(new Set(trainingSamples.map((sample) => sample.label))),
    samples: trainingSamples
  });
});

io.on('connection', (socket) =>
{
  socket.emit('hand:state', handState);
  socket.emit('controller:state', getControllerState());
  socket.emit('controller:count', getConnectedControllerCount());
  socket.emit('recognition:state', recognitionState);

  socket.on('controller:join', (payload: { finger?: unknown }) =>
  {
    if (!isFinger(payload?.finger))
    {
      return;
    }

    controllerSockets[payload.finger].add(socket.id);
    socket.data.controllerFinger = payload.finger;

    io.emit('controller:state', getControllerState());
    io.emit('controller:count', getConnectedControllerCount());
    socket.emit('hand:state', handState);
  });

  socket.on('finger:update', async (payload: { finger?: unknown; value?: unknown }) =>
  {
    if (!isFinger(payload?.finger))
    {
      return;
    }

    handState[payload.finger] = clampFingerValue(payload.value);
    await updateRecognitionState();
    io.emit('hand:state', handState);
    io.emit('recognition:state', recognitionState);
  });

  socket.on('virtual:skeleton', (payload: VirtualSkeleton) =>
  {
    if (!isVirtualSkeleton(payload))
    {
      return;
    }

    latestVirtualSkeleton = payload;
    io.emit('virtual:skeleton', latestVirtualSkeleton);
  });

  socket.on('disconnect', () =>
  {
    const joinedFinger = socket.data.controllerFinger;

    if (isFinger(joinedFinger))
    {
      controllerSockets[joinedFinger].delete(socket.id);
    }

    io.emit('controller:state', getControllerState());
    io.emit('controller:count', getConnectedControllerCount());
  });
});

function createRecognitionState(): RecognitionState
{
  const current = predictJamo(handState, trainingSamples);
  return {
    current,
    tokens: [],
    rawJamo: '',
    composedText: '',
    correctedWord: '',
    correctedWords: [],
    candidates: [],
    finalized: false,
    note: 'waiting for the first non-rest jamo',
    samplesPerLabel: trainingSamples.length / 31,
    updatedAt: new Date().toISOString()
  };
}

async function updateRecognitionState(): Promise<void>
{
  const current = predictJamo(handState, trainingSamples);
  recognitionState.current = current;
  recognitionState.finalized = false;
  recognitionState.updatedAt = new Date().toISOString();

  if (current.status === 'rest' || current.jamo === null)
  {
    lastAppendedJamo = null;
    recognitionState.note = 'all five fingers are open; rest pose is not assigned to a jamo';
    return;
  }

  if (current.jamo !== lastAppendedJamo)
  {
    recognitionState.tokens.push(current.jamo);
    lastAppendedJamo = current.jamo;
  }

  if (recognitionState.tokens.length >= 6)
  {
    const tokensToCorrect = recognitionState.tokens.slice(0, 6);
    recognitionState.rawJamo = tokensToCorrect.join('');
    recognitionState.composedText = '';
    recognitionState.candidates = [];
    recognitionState.note = 'correcting 6 jamo with local Ollama LLM';
    io.emit('recognition:state', recognitionState);

    const correction = await correctWord(tokensToCorrect);
    recognitionState.rawJamo = correction.rawJamo;
    recognitionState.composedText = correction.composedText;
    recognitionState.correctedWord = correction.correctedWord;
    recognitionState.correctedWords.push(correction.correctedWord);
    recognitionState.candidates = correction.candidates;
    recognitionState.note = correction.note;
    recognitionState.tokens = [];
    recognitionState.finalized = true;
    return;
  }

  recognitionState.rawJamo = recognitionState.tokens.join('');
  recognitionState.composedText = '';
  recognitionState.candidates = [];
  recognitionState.note = `auto-appending unique jamo changes; ${6 - recognitionState.tokens.length} more before correction`;
}

function resetRecognitionState(): void
{
  const next = createRecognitionState();
  Object.assign(recognitionState, next);
  lastAppendedJamo = null;
}

function isVirtualSkeleton(value: unknown): value is VirtualSkeleton
{
  if (typeof value !== 'object' || value === null)
  {
    return false;
  }

  const candidate = value as Partial<VirtualSkeleton>;
  return (
    candidate.source === 'virtual-hand-rigged-final' &&
    (candidate.handedness === 'Right' || candidate.handedness === 'Left' || candidate.handedness === 'Unknown') &&
    typeof candidate.timestamp === 'string' &&
    Array.isArray(candidate.points) &&
    candidate.points.length === 21 &&
    candidate.points.every((point) =>
      Array.isArray(point) &&
      point.length === 3 &&
      point.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    )
  );
}

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
  console.log(`Socket server running on http://0.0.0.0:${PORT}`);
});
