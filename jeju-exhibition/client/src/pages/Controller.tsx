import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { socket } from '../socket/socket';
import FingerSlider from '../components/FingerSlider';
import {
  FINGER_LABELS,
  FINGER_ORDER,
  FINGER_STATION,
  HandState,
  ParticipantState
} from '../socket/types';

type ControllerProps = {
  handState: HandState;
  serverOnline: boolean;
};

const SESSION_KEY = 'gesture-jeju-participant';

function createToken(): string
{
  return crypto.randomUUID?.() ?? `${Date.now()}-${crypto.getRandomValues(new Uint32Array(4)).join('-')}`;
}

function loadToken(previewKey?: string): string
{
  try
  {
    const storage = previewKey ? sessionStorage : localStorage;
    const key = previewKey ?? SESSION_KEY;
    const stored = storage.getItem(key);
    if (stored && /^[A-Za-z0-9_-]{16,128}$/.test(stored))
    {
      return stored;
    }
    const created = createToken();
    storage.setItem(key, created);
    return created;
  }
  catch
  {
    return createToken();
  }
}

function forgetToken(previewKey?: string): void
{
  try
  {
    (previewKey ? sessionStorage : localStorage).removeItem(previewKey ?? SESSION_KEY);
  }
  catch
  {
    // 사생활 보호 모드처럼 storage가 막혀도 현재 참여 종료는 계속한다.
  }
}

export default function Controller({ handState, serverOnline }: ControllerProps)
{
  const [searchParams] = useSearchParams();
  const { finger: pathFinger } = useParams();
  const rawFinger = pathFinger ?? searchParams.get('finger');
  const requestedFinger = FINGER_ORDER.find((finger) => finger === rawFinger);
  const invalidFinger = rawFinger !== null && !requestedFinger;
  const preview = searchParams.get('preview') === '1' && !!requestedFinger;
  // The five overview frames need separate roles without replacing a phone's participant token.
  const previewKey = preview ? `${SESSION_KEY}-preview-${requestedFinger}` : undefined;
  const [token, setToken] = useState(() => loadToken(previewKey));
  const [participant, setParticipant] = useState<ParticipantState | null>(null);
  const [error, setError] = useState('');
  const finished = useRef(false);

  useEffect(() =>
  {
    const join = (): void =>
    {
      if (!finished.current && !invalidFinger) socket.emit('participant:join', { token, finger: requestedFinger });
    };
    const onState = (next: ParticipantState): void =>
    {
      if (next.status === 'released') finished.current = true;
      if (finished.current && next.status !== 'released') return;
      setParticipant(next);
      setError('');
    };
    const onError = (payload: { message?: string }): void =>
      setError(payload.message ?? '참여 연결에 실패했습니다.');

    socket.on('connect', join);
    socket.on('participant:state', onState);
    socket.on('participant:error', onError);
    if (socket.connected)
    {
      join();
    }

    return () =>
    {
      socket.off('connect', join);
      socket.off('participant:state', onState);
      socket.off('participant:error', onError);
    };
  }, [token, requestedFinger, invalidFinger]);

  const leave = (): void =>
  {
    finished.current = true;
    socket.emit('participant:leave');
    forgetToken(previewKey);
    setParticipant({
      status: 'released',
      finger: null,
      queuePosition: null,
      summary: participant?.summary ?? { connectedCount: 0, occupiedCount: 0, waitingCount: 0 }
    });
  };

  const rejoin = (): void =>
  {
    finished.current = false;
    setError('');
    const nextToken = loadToken(previewKey);
    setParticipant(null);
    setToken(nextToken);
    if (nextToken === token && socket.connected)
    {
      socket.emit('participant:join', { token: nextToken, finger: requestedFinger });
    }
  };

  if (invalidFinger)
  {
    return (
      <main className="controller-screen controller-screen--message">
        <h1>손가락 QR을 다시 확인해 주세요</h1>
        <p>엄지·검지·중지·약지·소지 중 하나의 QR로 접속해 주세요.</p>
      </main>
    );
  }

  if (error)
  {
    return (
      <main className="controller-screen controller-screen--message">
        <p className="controller-kicker">GESTURE</p>
        <h1>연결할 수 없습니다</h1>
        <p aria-live="assertive">{error}</p>
        <button className="controller-primary" type="button" onClick={() =>
        {
          setError('');
          socket.emit('participant:join', { token, finger: requestedFinger });
        }}>다시 시도</button>
      </main>
    );
  }

  if (!serverOnline || participant === null)
  {
    return (
      <main className="controller-screen controller-screen--message">
        <p className="controller-kicker">GESTURE</p>
        <div className="controller-loader" aria-hidden="true" />
        <h1>{serverOnline ? requestedFinger ? `${FINGER_LABELS[requestedFinger]}에 연결하고 있습니다` : '빈 손가락을 찾고 있습니다' : '작품에 다시 연결하고 있습니다'}</h1>
        <p aria-live="polite">이 화면을 열어 두면 자동으로 연결됩니다.</p>
        <p>작품 Wi-Fi에 연결되어 있는지 확인해 주세요.</p>
        <a href="/check">연결 점검</a>
      </main>
    );
  }

  if (participant.status === 'waiting')
  {
    return (
      <main className="controller-screen controller-screen--message">
        <p className="controller-kicker">{requestedFinger ? `${FINGER_LABELS[requestedFinger]}는 지금 다른 사람이 움직이는 중` : '다섯 손가락이 함께 움직이는 중'}</p>
        <div className="controller-queue-number">{participant.queuePosition ?? '—'}</div>
        <h1>{requestedFinger ? `번째로 ${FINGER_LABELS[requestedFinger]}를 기다리고 있습니다` : '번째로 기다리고 있습니다'}</h1>
        <p aria-live="polite">자리가 나면 이 화면이 자동으로 조종기로 바뀝니다.</p>
        <p className="controller-subtle">현재 {participant.summary.connectedCount}명이 참여 중입니다.</p>
        <button className="controller-secondary" type="button" onClick={leave}>대기 그만두기</button>
      </main>
    );
  }

  if (participant.status === 'released' || !participant.finger)
  {
    return (
      <main className="controller-screen controller-screen--message">
        <p className="controller-kicker">GESTURE</p>
        <h1>참여를 마쳤습니다</h1>
        <p>당신이 움직이던 손가락은 다음 사람을 기다립니다.</p>
        <button className="controller-primary" type="button" onClick={rejoin}>다시 참여하기</button>
      </main>
    );
  }

  const finger = participant.finger;
  const value = handState[finger];
  const send = (next: number): void =>
  {
    socket.emit('finger:update', { value: next });
  };

  return (
    <main className={`controller-screen controller-screen--control controller-screen--${finger}${preview ? ' controller-screen--preview' : ''}`}>
      {preview && <header className="exhibition-masthead">
        <span className="exhibition-mark">GeSTure<span className="exhibition-mark__dot">.</span></span>
        <span className="controller-station">0{FINGER_STATION[finger]} <span>/ 05</span></span>
      </header>}
      <div className="controller-heading">
        <h1 id="controller-finger-name" className="controller-name">{FINGER_LABELS[finger]}</h1>
        {preview && <p className="controller-instruction">천천히 움직이고, 잠시 머물러 보세요.</p>}
      </div>
      <FingerSlider key={finger} value={value} onChange={send} />
      {preview && <div className="controller-bottom">
        <div className="controller-quick">
          <button type="button" onClick={() => send(0)}>완전히 접기</button>
          <button type="button" onClick={() => send(50)}>반쯤</button>
          <button type="button" onClick={() => send(100)}>완전히 펴기</button>
        </div>
        <button className="controller-release" type="button" onClick={leave}>조종 자리 비우기</button>
      </div>}
    </main>
  );
}
