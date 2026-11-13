import { FINGER_LABELS, FINGER_ORDER } from '../socket/types';

type TabletControllersProps = {
  serverOnline: boolean;
  latestWord: string;
  correcting: boolean;
};

export default function TabletControllers({ serverOnline, latestWord, correcting }: TabletControllersProps)
{
  return (
    <main className="tablet-controllers">
      <header className="tablet-controllers__header">
        <h1>GeSTure</h1>
        <p>위로 펴고, 아래로 접어 보세요.</p>
        <span role="status">{serverOnline ? '연결됨' : '연결을 기다리고 있습니다'}</span>
      </header>
      <section className="tablet-controllers__word" aria-label="최근 생성된 단어" aria-live="polite" aria-atomic="true">
        <p className="tablet-controllers__word-label">함께 만든 단어</p>
        {latestWord ? <h2 className="tablet-controllers__word-value">{latestWord}</h2> :
          <p className="tablet-controllers__word-empty">우리의 움직임이 단어가 됩니다.</p>}
        <p className="tablet-controllers__word-status">
          {!serverOnline ? '연결이 복구되면 새 단어가 표시됩니다.' : correcting ?
            '움직임을 단어로 만들고 있어요' : latestWord ?
              '다음 단어도 함께 만들어 보세요.' : '손가락을 움직이고 잠시 머물러 보세요.'}
        </p>
      </section>
      <section className="tablet-controllers__grid" aria-label="다섯 손가락 조종기">
        {FINGER_ORDER.map(finger => (
          <iframe key={finger} title={`${FINGER_LABELS[finger]} 조종기`}
            src={`/control/${finger}?preview=1&panel=1`} />
        ))}
      </section>
    </main>
  );
}
