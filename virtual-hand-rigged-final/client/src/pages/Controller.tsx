import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import FingerController from '../components/FingerController';
import { socket } from '../socket/socket';
import { FingerName, FINGER_LABELS, FINGER_ORDER, HandState } from '../socket/types';

type ControllerProps = {
  handState: HandState;
  serverOnline: boolean;
};

function isFinger(value: string | undefined): value is FingerName
{
  return FINGER_ORDER.includes(value as FingerName);
}

export default function Controller({ handState, serverOnline }: ControllerProps)
{
  const params = useParams();
  const finger = useMemo(() => isFinger(params.finger) ? params.finger : undefined, [params.finger]);

  useEffect(() =>
  {
    if (!finger)
    {
      return;
    }

    socket.emit('controller:join', { finger });
  }, [finger]);

  if (!finger)
  {
    return (
      <main className="controller-screen">
        <div className="controller-shell">
          <section className="controller-card glass-card">
            <p className="eyebrow">INVALID CONTROLLER</p>
            <h1>잘못된 조종 링크다</h1>
            <Link className="text-link" to="/links">링크 화면으로 돌아가기</Link>
          </section>
        </div>
      </main>
    );
  }

  const handleChange = (nextValue: number) =>
  {
    socket.emit('finger:update', {
      finger,
      value: nextValue
    });
  };

  return (
    <main className="controller-screen">
      <div className="controller-shell">
        <FingerController
          finger={finger}
          value={handState[finger]}
          serverOnline={serverOnline}
          onChange={handleChange}
        />

        <p className="controller-caption">
          이 화면은 {FINGER_LABELS[finger]} 하나만 조종한다. 여러 조종자의 값이 모여 하나의 손 모양을 만든다.
        </p>
      </div>
    </main>
  );
}
