import { useEffect, useRef, useState } from 'react';
import { FINGER_LABELS, FINGER_ORDER, FINGER_STATION, RecognitionState, WordCloudState } from '../socket/types';

function ScreenPreview({ title, path, width, height }: {
  title: string;
  path: string;
  width: number;
  height: number;
})
{
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() =>
  {
    const observer = new ResizeObserver(([entry]) =>
    {
      setScale(Math.min(entry.contentRect.width / width, entry.contentRect.height / height));
    });
    observer.observe(container.current!);
    return () => observer.disconnect();
  }, [width, height]);

  return (
    <article className="exhibition-preview">
      <header className="exhibition-preview__label">
        <h2>{title}</h2>
        <a href={path} target="_blank" rel="noopener noreferrer" aria-label={`${title} 크게 열기`}>크게 열기 ↗</a>
      </header>
      <div ref={container} className="exhibition-preview__viewport">
        <iframe
          title={`${title} 실시간 화면`}
          src={path}
          style={{ width, height, transform: `translate(-50%, -50%) scale(${scale})` }}
        />
      </div>
    </article>
  );
}

export default function Exhibition({ serverOnline, recognitionState, wordCloudState }: {
  serverOnline: boolean;
  recognitionState: RecognitionState;
  wordCloudState: WordCloudState;
})
{
  const { correction, correcting } = recognitionState;
  const latestSentence = wordCloudState.sentences.slice(-1)[0];

  return (
    <main className="exhibition-overview">
      <header className="exhibition-overview__head">
        <div>
          <span className="exhibition-mark">GeSTure<span className="exhibition-mark__dot">.</span></span>
          <h1>전시 화면 모아보기</h1>
        </div>
        <p className={serverOnline ? 'is-online' : 'is-offline'} role="status">
          {serverOnline ? '실시간 연결됨' : '서버 연결을 기다리고 있습니다'}
        </p>
      </header>

      <section className="exhibition-overview__displays" aria-label="전시 디스플레이">
        <ScreenPreview title="손" path="/display/hand" width={600} height={800} />
        <ScreenPreview title="단어" path="/display/word" width={960} height={600} />
        <ScreenPreview title="워드클라우드" path="/word-cloud/" width={1280} height={800} />
      </section>

      <p className="exhibition-overview__correction" role="status">
        {correcting ? '모인 움직임으로 단어를 만드는 중입니다.' : correction?.correctedWord ? (
          <>마지막 단어 ‘{correction.correctedWord}’ · 입력 자모 {correction.inputJamoCount}개 반영 · {correction.source === 'llm' ? 'AI' : '단어장'} 보완 {correction.supplementedJamoCount}개</>
        ) : '손 모양 6개가 모이면 생성된 단어의 입력 반영 수와 보완 수를 확인할 수 있습니다.'}
      </p>

      <div className="exhibition-overview__cloud-status" role="status" aria-label="워드클라우드 상태">
        <span>워드클라우드 {wordCloudState.words.length}개</span>
        <span>{wordCloudState.generating ? 'Ollama가 모인 단어로 문장을 잇고 있습니다.' :
          wordCloudState.error ? '문장을 만들지 못했습니다. 다음 단어가 모이면 다시 시도합니다.' :
          latestSentence ? latestSentence.text : '서로 다른 단어 2개부터 문장을 만듭니다.'}</span>
      </div>

      <section className="exhibition-overview__controllers" aria-label="다섯 손가락 조종기">
        {FINGER_ORDER.map((finger) => (
          <ScreenPreview
            key={finger}
            title={`0${FINGER_STATION[finger]} ${FINGER_LABELS[finger]}`}
            path={`/control/${finger}`}
            width={400}
            height={720}
          />
        ))}
      </section>

      <footer className="exhibition-overview__note">
        <span>아래 조종기를 움직이면 위의 손과 단어 화면에 실시간으로 반영됩니다.</span>
        <span>전시장에서는 각 화면의 ‘크게 열기’ 주소를 해당 디스플레이에 띄워주세요.</span>
      </footer>
    </main>
  );
}
