import { FingerName, FINGER_LABELS } from '../socket/types';

type FingerControllerProps = {
  finger: FingerName;
  value: number;
  serverOnline: boolean;
  onChange: (nextValue: number) => void;
};

export default function FingerController({ finger, value, serverOnline, onChange }: FingerControllerProps)
{
  return (
    <section className="controller-card glass-card">
      <div className="controller-card__head">
        <p className="eyebrow">FINGER CONTROL</p>
        <h1>{FINGER_LABELS[finger]}</h1>
        <p>{serverOnline ? 'Display Screen과 연결되어 있다.' : '서버 연결을 기다리는 중이다.'}</p>
      </div>

      <div className="controller-value">
        <span>{value}</span>
        <small>/ 100</small>
      </div>

      <input
        className="controller-slider"
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />

      <div className="controller-scale">
        <span>CLOSED</span>
        <span>OPEN</span>
      </div>
    </section>
  );
}
