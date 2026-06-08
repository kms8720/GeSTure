import { Link } from 'react-router-dom';
import VirtualHand from '../components/VirtualHand';
import ConnectionStatus from '../components/ConnectionStatus';
import { ControllerState, FINGER_LABELS, FINGER_ORDER, HandState, RecognitionState } from '../socket/types';

type DisplayProps = {
  handState: HandState;
  controllerState: ControllerState;
  connectedCount: number;
  serverOnline: boolean;
  recognitionState: RecognitionState;
};

function SignalWave()
{
  return (
    <svg className="hud-wave" viewBox="0 0 360 90" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M0 45H28L38 18L46 70L54 30L64 58L74 12L84 78L94 40L104 45H132L142 20L152 70L162 30L172 58L182 12L192 78L202 45H228L238 26L246 66L254 34L262 52L272 22L282 72L290 45H360"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OrbitLines()
{
  return (
    <svg className="hud-orbits" viewBox="0 0 1200 800" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="610" cy="405" rx="450" ry="130" />
      <ellipse cx="610" cy="405" rx="520" ry="185" />
      <path d="M140 470C310 430 445 372 620 380C800 388 938 452 1110 420" />
      <path d="M162 560C310 520 486 494 628 500C792 508 930 560 1050 612" />
    </svg>
  );
}

export default function Display({ handState, controllerState, connectedCount, serverOnline, recognitionState }: DisplayProps)
{
  const currentJamo = recognitionState.current.jamo ?? 'REST';
  const latestWord = recognitionState.correctedWord || '...';

  return (
    <div className="display-screen">
      <div className="display-noise" />
      <div className="display-panel-grid" />
      <OrbitLines />

      <div className="display-canvas-layer">
        <VirtualHand handState={handState} />
      </div>

      <header className="display-topbar">
        <div className="display-topbar__left">
          <p className="display-eyebrow">COLLECTIVE SIGNAL INTERFACE</p>
          <h1 className="display-title-small">Rigged Robotic Hand</h1>
        </div>

        <div className="display-topbar__right">
          <Link to="/links" className="hud-pill">CONTROLLER LINKS</Link>
          <Link to="/recognition" className="hud-pill">RECOGNITION</Link>
          <div className={`hud-pill hud-pill--status ${serverOnline ? 'is-online' : 'is-offline'}`}>
            <span className="hud-pill__dot" />
            {serverOnline ? 'SERVER ONLINE' : 'SERVER OFFLINE'}
          </div>
        </div>
      </header>

      <ConnectionStatus controllerState={controllerState} handState={handState} connectedCount={connectedCount} />

      <section className="word-card glass-card">
        <div className="word-card__head">
          <span>AUTO WORD</span>
          <strong>{latestWord}</strong>
        </div>
        <div className="word-card__meta">
          <span>NOW</span>
          <b>{currentJamo}</b>
          <span>{recognitionState.current.bitString}</span>
        </div>
        <p>{recognitionState.rawJamo || '자모 입력 대기 중'}</p>
      </section>

      <section className="data-card glass-card">
        <div className="data-card__head">
          <span>MOTION READOUT</span>
        </div>

        <div className="data-bars">
          {FINGER_ORDER.map((finger) => (
            <div key={finger} className="data-bar">
              <div className="data-bar__meta">
                <span>{FINGER_LABELS[finger]}</span>
                <strong>{handState[finger]}</strong>
              </div>
              <div className="data-bar__track">
                <div className="data-bar__fill" style={{ width: `${handState[finger]}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="hud-cluster hud-cluster--left glass-outline">
        <span className="hud-cluster__label">SIGNAL FEED</span>
        <SignalWave />
      </div>

      <div className="hud-cluster hud-cluster--right glass-outline">
        <span className="hud-cluster__label">MOTION NETWORK</span>
        <div className="hud-node-map">
          <span className="hud-node hud-node--a" />
          <span className="hud-node hud-node--b" />
          <span className="hud-node hud-node--c" />
          <span className="hud-node hud-node--d" />
          <span className="hud-node hud-node--e" />
          <svg viewBox="0 0 240 120" aria-hidden="true">
            <path d="M30 60L90 34L126 62L174 40L210 84" />
            <path d="M30 60L126 62L210 84" opacity="0.45" />
          </svg>
        </div>
      </div>
    </div>
  );
}
