import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { socket } from '../socket/socket';
import {
  FINGER_LABELS,
  FINGER_ORDER,
  FINGER_STATION,
  FingerName,
  HandState
} from '../socket/types';

type ControllerProps = {
  handState: HandState;
  serverOnline: boolean;
};

function isFinger(value: string | undefined): value is FingerName
{
  return FINGER_ORDER.includes(value as FingerName);
}

/**
 * 조종기 디스플레이 한 대에 손가락 하나.
 *
 * ACC 전시는 관객 휴대폰으로 QR 접속했지만, 제주는 전용 디스플레이 5대를 세워두고
 * 각 화면을 /control/<손가락>에 고정해 띄운다. 그래서 QR도 링크 목록도 필요 없고,
 * 대신 손가락 하나만 크게 보여주는 것이 전부다.
 */
export default function Controller({ handState, serverOnline }: ControllerProps)
{
  const params = useParams();
  const finger = useMemo(() => (isFinger(params.finger) ? params.finger : undefined), [params.finger]);

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
        <div className="controller-error">
          <h1>잘못된 조종기 주소다</h1>
          <p>{FINGER_ORDER.map((entry) => `/control/${entry}`).join('  ·  ')}</p>
        </div>
      </main>
    );
  }

  const value = handState[finger];

  const send = (next: number): void =>
  {
    socket.emit('finger:update', { finger, value: next });
  };

  return (
    <main className="controller-screen">
      <div className="controller-station">{FINGER_STATION[finger]}</div>

      <h1 className="controller-name">{FINGER_LABELS[finger]}</h1>

      <div className="controller-readout">
        <span className="controller-readout__value">{value}</span>
      </div>

      <div className="controller-slider-wrap">
        <span className="controller-edge">펴짐</span>
        {/*
          세로 슬라이더를 writing-mode나 -webkit-appearance: slider-vertical로 만들면
          커스텀 트랙/썸 스타일과 충돌해 썸이 트랙에서 떨어진다.
          가로 슬라이더를 통째로 -90도 돌리는 쪽이 브라우저를 타지 않는다.
        */}
        <div className="controller-slider-shell">
          <input
            className="controller-slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(event) => send(Number(event.target.value))}
            aria-label={`${FINGER_LABELS[finger]} 굽힘 정도`}
          />
        </div>
        <span className="controller-edge">접힘</span>
      </div>

      <div className="controller-quick">
        <button type="button" onClick={() => send(0)}>완전히 접기</button>
        <button type="button" onClick={() => send(50)}>반쯤</button>
        <button type="button" onClick={() => send(100)}>완전히 펴기</button>
      </div>

      <p className={`controller-status ${serverOnline ? 'is-online' : 'is-offline'}`}>
        {serverOnline ? '손과 연결되어 있다' : '연결이 끊겼다'}
      </p>
    </main>
  );
}
