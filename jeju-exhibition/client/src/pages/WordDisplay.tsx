import { RecognitionState } from '../socket/types';

type WordDisplayProps = {
  recognitionState: RecognitionState;
  serverOnline: boolean;
};

/**
 * 단어가 뜨는 화면. 손 화면과 분리된 별도 디스플레이 한 대다.
 *
 * 손 화면에서 걷어낸 것들이 여기로 모인다.
 *   - 지금 손 모양이 될 수 있는 자모 후보
 *   - 슬롯 진행
 *   - 만들어진 단어와 지금까지 쌓인 말
 *
 * 디자인은 아직 확정 전이다. 지금은 무엇을 보여줄지만 정해둔 상태로 두고,
 * 레이아웃과 타이포는 나중에 손본다.
 */
export default function WordDisplay({ recognitionState, serverOnline }: WordDisplayProps)
{
  const { current, slots, slotsNeeded, correction, words, correcting, note } = recognitionState;
  const latestWord = correction?.correctedWord ?? '';
  const history = (latestWord ? words.slice(0, -1) : words).slice(-14);

  return (
    <div className="word-screen">
      <section className="word-screen__now">
        <p className="word-screen__label">지금 이 손 모양은</p>
        {current.status === 'rest' ? (
          <p className="word-screen__rest">손을 모두 펴면 쉬는 상태다</p>
        ) : (
          <>
            <div className="word-screen__candidates">
              {current.jamoCandidates.map((jamo) => (
                <span key={jamo} className="jamo-chip">{jamo}</span>
              ))}
            </div>
            {current.jamoCandidates.length > 1 && (
              <p className="word-screen__hint">이 중 무엇인지는 아직 정해지지 않았다</p>
            )}
          </>
        )}
      </section>

      <section className="slot-track">
        {Array.from({ length: slotsNeeded }, (_, index) =>
        {
          const slot = slots[index];
          return (
            <div key={index} className={`slot ${slot ? 'is-filled' : ''}`}>
              {slot?.candidates.map((jamo) => <span key={jamo}>{jamo}</span>)}
            </div>
          );
        })}
      </section>

      <section className={`word-main ${correcting ? 'is-working' : ''}`}>
        {correcting ? (
          <p className="word-main__working">모인 손 모양으로 단어를 찾는 중</p>
        ) : slots.length > 0 ? (
          <p className="word-main__waiting" aria-live="polite">
            손 모양 {slots.length}개 기록 · {Math.max(0, slotsNeeded - slots.length)}개 더 모으면 단어가 됩니다
          </p>
        ) : latestWord ? (
          <>
            <strong className="word-main__word">{latestWord}</strong>
            {correction && (
              <p className="word-main__meta">
                {correction.chosenJamo.join('')}
                {correction.source === 'vocabulary' && ' · 단어장'}
              </p>
            )}
          </>
        ) : (
          <p className="word-main__waiting">{note}</p>
        )}
      </section>

      {history.length > 0 && (
        <section className="word-trail">
          <span className="word-trail__label">지금까지 만들어진 말</span>
          <div className="word-trail__items">
            {history.map((word, index) => (
              <span key={`${word}-${index}`}>{word}</span>
            ))}
          </div>
        </section>
      )}

      {!serverOnline && <div className="offline-banner">서버 연결이 끊겼다</div>}
    </div>
  );
}
