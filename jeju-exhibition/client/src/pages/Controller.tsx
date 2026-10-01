import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket/socket';
import {
  FINGER_LABELS,
  FINGER_STATION,
  HandState,
  ParticipantState
} from '../socket/types';

type ControllerProps = {
  handState: HandState;
  serverOnline: boolean;
};

const SESSION_KEY = 'gesture-jeju-participant';
const STEPS = [0, 25, 50, 75, 100] as const;

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
  const [token, setToken] = useState(loadToken);
  const [participant, setParticipant] = useState<ParticipantState | null>(null);
  const [error, setError] = useState('');
  const finished = useRef(false);

  useEffect(() =>
  {
    const join = (): void =>
    {
      if (!finished.current) socket.emit('participant:join', { token });
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
  }, [token]);

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
    const nextToken = createToken();
    try
    {
      localStorage.setItem(SESSION_KEY, nextToken);
    }
    catch
    {
      // 메모리 안의 토큰으로도 현재 탭에서는 참여할 수 있다.
    }
    setParticipant(null);
    setToken(nextToken);
  };

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
          socket.emit('participant:join', { token });
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
        <h1>{serverOnline ? '빈 손가락을 찾고 있습니다' : '작품에 다시 연결하고 있습니다'}</h1>
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
        <p className="controller-kicker">다섯 손가락이 함께 움직이는 중</p>
        <div className="controller-queue-number">{participant.queuePosition ?? '—'}</div>
        <h1>번째로 기다리고 있습니다</h1>
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
      <header className="controller-header">
        <div className="controller-station" aria-label={`${FINGER_STATION[finger]}번 손가락`}>
          {FINGER_STATION[finger]}
        </div>
        <div>
          <p className="controller-kicker">당신이 움직이는 손가락</p>
          <h1 className="controller-name">{FINGER_LABELS[finger]}</h1>
        </div>
      </header>

      <section className="controller-controls" aria-label={`${FINGER_LABELS[finger]} 굽힘 단계`}>
        {STEPS.map((step) => (
          <button
            key={step}
            className={`controller-step ${Math.abs(value - step) < 13 ? 'is-current' : ''}`}
            type="button"
            aria-pressed={Math.abs(value - step) < 13}
            onClick={() => send(step)}
          >
            <strong>{step}</strong>
            <span>{step === 0 ? '접기' : step === 100 ? '펴기' : `${step}%`}</span>
          </button>
        ))}
      </section>

      <label className="controller-fine">
        <span>미세 조정</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(event) => send(Number(event.target.value))}
        />
        <output>{value}</output>
      </label>

      <p className={`controller-status ${serverOnline ? 'is-online' : 'is-offline'}`} aria-live="polite">
        {serverOnline ? '손과 연결되어 있습니다' : '다시 연결하고 있습니다'}
      </p>
      <p className="controller-subtle">지금 {participant.summary.connectedCount}명 참여 중 · 빈 자리 {5 - participant.summary.occupiedCount}개</p>
      <button className="controller-leave" type="button" onClick={leave}>참여 마치기</button>
    </main>
  );
}
