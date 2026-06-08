import { Link } from 'react-router-dom';
import { FINGER_LABELS, FINGER_ORDER, RecognitionState } from '../socket/types';

type RecognitionProps = {
  recognitionState: RecognitionState;
  serverOnline: boolean;
};

export default function Recognition({ recognitionState, serverOnline }: RecognitionProps)
{
  const { current } = recognitionState;
  const currentJamo = current.jamo ?? 'REST';
  const progress = recognitionState.tokens.length;

  return (
    <main className="recognition-screen">
      <header className="recognition-header">
        <div>
          <p className="eyebrow">SKELETAL JAMO RECOGNITION</p>
          <h1>자모 추정 모니터</h1>
          <p>엄지부터 새끼까지 5비트로 읽고, 6개 자모가 쌓이면 자동으로 단어를 보정한다.</p>
        </div>
        <div className="recognition-actions">
          <Link className="hud-pill" to="/display">DISPLAY</Link>
          <Link className="hud-pill" to="/links">LINKS</Link>
          <div className={`hud-pill hud-pill--status ${serverOnline ? 'is-online' : 'is-offline'}`}>
            <span className="hud-pill__dot" />
            {serverOnline ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>
      </header>

      <section className="recognition-grid">
        <article className="recognition-primary glass-card">
          <span className="recognition-label">CURRENT JAMO</span>
          <strong>{currentJamo}</strong>
          <div className="recognition-primary__meta">
            <span>{current.status === 'recognized' ? `INDEX ${current.index}` : 'UNASSIGNED REST'}</span>
            <span>{current.bitString}</span>
            <span>{Math.round(current.confidence * 100)}%</span>
          </div>
        </article>

        <article className="recognition-buffer glass-card">
          <span className="recognition-label">AUTO BUFFER</span>
          <div className="buffer-slots">
            {Array.from({ length: 6 }).map((_, index) => (
              <span key={index} className={index < progress ? 'is-filled' : ''}>
                {recognitionState.tokens[index] ?? ''}
              </span>
            ))}
          </div>
          <p>{recognitionState.note}</p>
        </article>

        <article className="recognition-word glass-card">
          <span className="recognition-label">CORRECTED WORD</span>
          <strong>{recognitionState.correctedWord || '...'}</strong>
          <p>{recognitionState.composedText || recognitionState.rawJamo || '6개 자모가 입력되면 여기에 보정 결과가 표시된다.'}</p>
        </article>

        <article className="recognition-bits glass-card">
          <span className="recognition-label">FINGER BITS</span>
          <div className="bit-list">
            {FINGER_ORDER.map((finger) => (
              <div key={finger} className="bit-row">
                <span>{FINGER_LABELS[finger]}</span>
                <strong>{current.bits[finger]}</strong>
                <em>{current.handState[finger]}</em>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
