import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { socket } from '../socket/socket';
import FingerSlider from '../components/FingerSlider';
import {
  FINGER_LABELS,
  FINGER_ORDER,
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

function loadToken(): string
{
  try
  {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored && /^[A-Za-z0-9_-]{16,128}$/.test(stored))
    {
      return stored;
    }
    const created = createToken();
    localStorage.setItem(SESSION_KEY, created);
    return created;
  }
  catch
  {
    return createToken();
  }
}

function forgetToken(): void
{
  try
  {
    localStorage.removeItem(SESSION_KEY);
  }
  catch
  {
    // 사생활 보호 모드처럼 storage가 막혀도 현재 참여 종료는 계속한다.
  }
}

export default function Controller({ handState, serverOnline }: ControllerProps)
{
  const [searchParams] = useSearchParams();
  const rawFinger = searchParams.get('finger');
  const requestedFinger = FINGER_ORDER.find((finger) => finger === rawFinger);
  const invalidFinger = rawFinger !== null && !requestedFinger;
  const [token, setToken] = useState(loadToken);
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
    forgetToken();
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
    const nextToken = loadToken();
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
    <main className={`controller-screen controller-screen--control controller-screen--${finger}`}>
      <h1 id="controller-finger-name" className="controller-name">{FINGER_LABELS[finger]}</h1>
      <FingerSlider key={finger} value={value} onChange={send} />
    </main>
  );
}
