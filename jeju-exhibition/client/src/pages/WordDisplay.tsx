import { RecognitionState } from '../socket/types';

type WordDisplayProps = {
  recognitionState: RecognitionState;
  serverOnline: boolean;
};

export default function WordDisplay({ recognitionState, serverOnline }: WordDisplayProps)
{
  const { current, slots, slotsNeeded, correction, words, correcting } = recognitionState;
  const latestWord = correction?.correctedWord ?? '';
  const history = words.slice(0, -1).slice(-4);

  return (
    <main className={`word-screen ${correcting ? 'is-working' : ''}`}>
      <header className="exhibition-masthead">
        <span className="exhibition-mark">GeSTure<span className="exhibition-mark__dot">.</span></span>
        <span className="exhibition-caption">낯선 공존</span>
      </header>

      <section className="word-main" aria-live="polite" aria-atomic="true">
        <p className="word-main__eyebrow">{latestWord ? '우리 사이에 놓인 말' : '아직 쓰이지 않은 말'}</p>
        {correcting ? (
          <div className="word-main__forming" aria-label="모인 움직임으로 단어를 만드는 중">
            <span /><span /><span />
          </div>
        ) : latestWord ? (
          <h1 key={`${words.length}-${latestWord}`} className="word-main__word" data-length={latestWord.length}>{latestWord}</h1>
        ) : (
          <h1 className="word-main__invitation">함께 움직여<br />하나의 말이 됩니다.</h1>
        )}
        <p className="word-main__subline">
          {correcting ? '서로의 움직임이 만나는 동안' : latestWord ? '다섯 사람의 움직임, 하나의 언어' : '손가락을 움직이고 잠시 머물러 보세요.'}
        </p>
      </section>

      <section className="word-progress" aria-label={`손 모양 ${correcting ? slotsNeeded : slots.length}개 기록, 전체 ${slotsNeeded}개`}>
        <div className="slot-track" aria-hidden="true">
          {Array.from({ length: slotsNeeded }, (_, index) => (
            <span key={index} className={`slot ${correcting || slots[index] ? 'is-filled' : ''}`} />
          ))}
        </div>
        <div className="word-screen__candidates" aria-label="현재 자모 후보">
          {current.status === 'rest' ? <span className="word-screen__rest">다음 움직임을 기다립니다</span> :
            current.jamoCandidates.map((jamo) => <span key={jamo} className="jamo-glyph">{jamo}</span>)}
        </div>
      </section>

      <footer className="exhibition-footer">
        <span className="exhibition-footer__label">함께 남긴 말</span>
        <div className="word-trail" aria-label="이전에 만들어진 단어">
          {history.length ? history.map((word, index) => <span key={`${word}-${index}`}>{word}</span>) : <span className="word-trail__empty">—</span>}
        </div>
        <span className="exhibition-footer__edition">GESTURE · JEJU</span>
      </footer>

      {!serverOnline && <div className="offline-banner" role="status">잠시 연결을 기다리고 있습니다</div>}
    </main>
  );
}
