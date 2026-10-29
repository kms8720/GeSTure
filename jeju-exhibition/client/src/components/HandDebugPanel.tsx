import { RecognitionState } from '../socket/types';

type Props = { recognitionState: RecognitionState; latestSavedWord: string; serverOnline: boolean; onHide: () => void };

export default function HandDebugPanel({ recognitionState, latestSavedWord, serverOnline, onHide }: Props)
{
  const { current, slots, processingSlots, slotsNeeded, correcting, correction, words, note } = recognitionState;
  const showingPrevious = !correcting && slots.length === 0 && Boolean(correction);
  const inputs = correcting ? processingSlots ?? [] : showingPrevious ? correction!.slots : slots;
  const latestWord = correction?.correctedWord || words[words.length - 1] || latestSavedWord;

  return (
    <aside className="hand-debug" aria-label="손 입력 디버그">
      <header className="hand-debug__header">
        <h1>입력 디버그</h1>
        <span className={serverOnline ? 'is-online' : 'is-offline'}>{serverOnline ? '연결됨' : '연결 끊김'}</span>
        <button type="button" onClick={onHide}>숨기기 <kbd>D</kbd></button>
      </header>
      <section>
        <h2>현재 손 모양의 자모 후보</h2>
        <p className="hand-debug__current">{current.status === 'rest' ? '쉬는 자세 · 입력 없음' : current.jamoCandidates.join(' / ') || '—'}</p>
      </section>
      <section>
        <h2>{correcting ? '생성에 사용 중인 입력' : showingPrevious ? '직전 단어의 입력' : '기록된 입력'} <span>{inputs.length} / {slotsNeeded}</span></h2>
        <ol className="hand-debug__slots">
          {Array.from({ length: slotsNeeded }, (_, index) => (
            <li key={index} className={inputs[index] ? 'is-filled' : ''}>
              <small>{index + 1}</small><span>{inputs[index]?.candidates.join(' / ') || '—'}</span>
            </li>
          ))}
        </ol>
        <p className="hand-debug__hint">한 칸은 손 모양 하나입니다. / 로 나뉜 자모는 같은 모양의 후보입니다.</p>
      </section>
      <section className="hand-debug__result" aria-live="polite">
        <h2>{correcting ? '단어 생성 중…' : '최근 생성 단어'}</h2>
        <strong>{latestWord || '아직 생성 전'}</strong>
        {!correction && words.length === 0 && latestSavedWord && <p>저장된 이전 단어 · 입력 상세 없음</p>}
        {correction && <p>선택 자모 · {correction.chosenJamo.join(' ')}<br />
          {correction.source === 'llm' ? '로컬 모델' : correction.source === 'vocabulary' ? '단어장 대체' : '생성 결과 없음'} · {correction.elapsedMs}ms</p>}
      </section>
      <p className="hand-debug__note">{note}</p>
    </aside>
  );
}
