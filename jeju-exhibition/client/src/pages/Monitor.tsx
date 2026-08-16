import { useEffect, useState } from 'react';
import {
  ControllerState,
  FINGER_LABELS,
  FINGER_ORDER,
  HandState,
  PoseClass,
  RecognitionState
} from '../socket/types';

type MonitorProps = {
  handState: HandState;
  controllerState: ControllerState;
  recognitionState: RecognitionState;
  poseClasses: PoseClass[];
  serverOnline: boolean;
};

/**
 * 운영자용 화면. 전시 관객에게는 보이지 않는다.
 *
 * ACC 버전에서 미구현으로 남아 있던 reset과 강제 확정 버튼을 여기 넣었다.
 * 관객이 손 모양을 다 채우지 않고 떠났을 때 운영자가 끊어줄 수단이 필요하다.
 */
export default function Monitor({ handState, controllerState, recognitionState, poseClasses, serverOnline }: MonitorProps)
{
  const { current, slots, slotsNeeded, correction, words, correcting, note, updatedAt } = recognitionState;
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<string>('확인 중');

  useEffect(() =>
  {
    fetch('/health')
      .then((response) => response.json())
      .then((data) => setHealth(`포즈 클래스 ${data.poseClasses}개, 포트 ${data.port}`))
      .catch((error) => setHealth(`확인 실패: ${error}`));
  }, []);

  const post = async (url: string): Promise<void> =>
  {
    setBusy(true);
    try
    {
      await fetch(url, { method: 'POST' });
    }
    finally
    {
      setBusy(false);
    }
  };

  return (
    <main className="monitor">
      <header className="monitor__head">
        <h1>운영 모니터</h1>
        <div className="monitor__actions">
          <button type="button" disabled={busy} onClick={() => post('/recognition/reset')}>초기화</button>
          <button type="button" disabled={busy || slots.length === 0} onClick={() => post('/recognition/finalize')}>
            지금까지로 단어 만들기
          </button>
        </div>
        <span className={`monitor__status ${serverOnline ? 'is-online' : 'is-offline'}`}>
          {serverOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
      </header>

      <p className="monitor__health">{health} · 마지막 갱신 {updatedAt || '-'}</p>

      <section className="monitor__grid">
        <div className="monitor__card">
          <h2>손가락</h2>
          <table>
            <tbody>
              {FINGER_ORDER.map((finger) => (
                <tr key={finger}>
                  <td>{FINGER_LABELS[finger]}</td>
                  <td className="num">{handState[finger]}</td>
                  <td>{controllerState[finger] ? '조종기 연결' : '조종기 없음'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="monitor__card">
          <h2>현재 인식</h2>
          <dl>
            <dt>상태</dt><dd>{current.status}</dd>
            <dt>클래스</dt><dd>{current.classId ?? '-'}</dd>
            <dt>자모 후보</dt><dd>{current.jamoCandidates.join(' / ') || '-'}</dd>
            <dt>거리</dt><dd>{current.distance.toFixed(1)} (보정 {current.adjustedDistance.toFixed(1)})</dd>
            <dt>확신도</dt><dd>{current.confidence.toFixed(2)}</dd>
            <dt>2순위</dt><dd>{current.runnerUpClassId ?? '-'}</dd>
          </dl>
        </div>

        <div className="monitor__card">
          <h2>슬롯 {slots.length} / {slotsNeeded}</h2>
          <ol className="monitor__slots">
            {slots.map((slot, index) => (
              <li key={`${slot.classId}-${index}`}>
                <code>{slot.classId}</code> → {slot.candidates.join(' / ')}
              </li>
            ))}
          </ol>
          <p className="monitor__note">{correcting ? '보정 중' : note}</p>
        </div>

        <div className="monitor__card">
          <h2>마지막 단어</h2>
          {correction ? (
            <dl>
              <dt>단어</dt><dd className="big">{correction.correctedWord}</dd>
              <dt>고른 자모</dt><dd>{correction.chosenJamo.join('')}</dd>
              <dt>조합</dt><dd>{correction.composedText}</dd>
              <dt>후보</dt><dd>{correction.candidates.join(', ')}</dd>
              <dt>경로</dt><dd>{correction.source} / {correction.status}</dd>
              <dt>모델</dt><dd>{correction.model}</dd>
              <dt>소요</dt><dd>{correction.elapsedMs}ms</dd>
              <dt>메모</dt><dd>{correction.note}</dd>
            </dl>
          ) : <p>아직 없다</p>}
        </div>

        <div className="monitor__card monitor__card--wide">
          <h2>포즈 클래스 {poseClasses.length}개</h2>
          <table className="monitor__poses">
            <thead>
              <tr>
                <th>자모 후보</th>
                {FINGER_ORDER.map((finger) => <th key={finger} className="num">{FINGER_LABELS[finger]}</th>)}
                <th className="num">bias</th>
                <th className="num">도달%</th>
              </tr>
            </thead>
            <tbody>
              {poseClasses.map((entry) => (
                <tr key={entry.id} className={entry.id === current.classId ? 'is-current' : ''}>
                  <td>{entry.jamo.join('/')}</td>
                  {FINGER_ORDER.map((finger) => (
                    <td key={finger} className="num">{Math.round(entry.flexion[finger])}</td>
                  ))}
                  <td className="num">{entry.bias}</td>
                  <td className="num">{entry.reachShare}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="monitor__card monitor__card--wide">
          <h2>만들어진 단어</h2>
          <p className="monitor__words">{words.join('  ·  ') || '아직 없다'}</p>
        </div>
      </section>
    </main>
  );
}
