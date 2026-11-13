import { FINGER_LABELS, FINGER_ORDER } from '../socket/types';

export default function TabletControllers({ serverOnline }: { serverOnline: boolean })
{
  return (
    <main className="tablet-controllers">
      <header className="tablet-controllers__header">
        <h1>GeSTure</h1>
        <p>위로 펴고, 아래로 접어 보세요.</p>
        <span role="status">{serverOnline ? '연결됨' : '연결을 기다리고 있습니다'}</span>
      </header>
      <section className="tablet-controllers__grid" aria-label="다섯 손가락 조종기">
        {FINGER_ORDER.map(finger => (
          <iframe key={finger} title={`${FINGER_LABELS[finger]} 조종기`}
            src={`/control/${finger}?preview=1&panel=1`} />
        ))}
      </section>
    </main>
  );
}
