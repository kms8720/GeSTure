import { useEffect, useRef } from 'react';
import { WordCloudState } from '../../../shared/wordCloud';
import { EXHIBITION_THEME } from '../../../shared/exhibitionTheme';
import { createWordCloudScene } from '../display/wordCloudScene';
import '../styles/word-cloud.css';

type WordDisplayProps = { wordCloud: WordCloudState; serverOnline: boolean };

export default function WordDisplay({ wordCloud, serverOnline }: WordDisplayProps)
{
  const stage = useRef<HTMLElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const sentence = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLDivElement>(null);
  const announcer = useRef<HTMLParagraphElement>(null);
  const scene = useRef<ReturnType<typeof createWordCloudScene> | null>(null);
  useEffect(() =>
  {
    scene.current = createWordCloudScene(stage.current!, layer.current!, sentence.current!, title.current!, announcer.current!);
    return () => { scene.current?.destroy(); scene.current = null; };
  }, []);
  useEffect(() => { scene.current?.update(wordCloud); }, [wordCloud]);

  return (
    <main ref={stage} className="wc-stage" aria-label="관객이 함께 만든 단어 구름">
      <div className="wc-grain" aria-hidden="true" />
      <div className="wc-orbit wc-orbit-one" aria-hidden="true" />
      <div className="wc-orbit wc-orbit-two" aria-hidden="true" />
      <div className="wc-orbit wc-orbit-three" aria-hidden="true" />
      <div className="wc-crosshair wc-crosshair-one" aria-hidden="true">＋</div>
      <div className="wc-crosshair wc-crosshair-two" aria-hidden="true">＋</div>
      <header className="wc-stage-top">
        <span>01 / LANGUAGE IN MOTION</span>
        <span className={`wc-live${serverOnline ? '' : ' is-offline'}`}><i />{serverOnline ? 'LIVE COMPOSITION' : 'RECONNECTING'}</span>
      </header>
      <div ref={sentence} className="wc-sentence" aria-hidden="true" />
      <div ref={title} className="wc-title-core">
        <span className="wc-title-eyebrow">WORDS IN ORBIT</span>
        <h1>WORD <b>CLOUD</b></h1>
        <span className="wc-title-line" />
      </div>
      <div ref={layer} className="wc-floating-words" aria-hidden="true" />
      {wordCloud.words.length === 0 && <p className="wc-empty">함께 만든 첫 단어를 기다립니다</p>}
      <footer className="wc-stage-bottom">
        <span>{wordCloud.words.length} WORDS IN MOTION</span>
        <span className="wc-stage-caption">{EXHIBITION_THEME.name}</span>
        <span className="wc-cycle-mark" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} />)}</span>
      </footer>
      <p className="wc-sr-only">모인 단어: {wordCloud.words.join(', ') || '아직 없음'}</p>
      <p ref={announcer} className="wc-sr-only" aria-live="polite" aria-atomic="true" />
    </main>
  );
}
