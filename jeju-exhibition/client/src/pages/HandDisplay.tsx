import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import VirtualHand from '../components/VirtualHand';
import HandDebugPanel from '../components/HandDebugPanel';
import { HandState, RecognitionState } from '../socket/types';

type HandDisplayProps = {
  handState: HandState;
  recognitionState: RecognitionState;
  latestSavedWord: string;
  serverOnline: boolean;
};

/**
 * 손만 보이는 화면. 세로로 세운 디스플레이 한 대를 통째로 쓴다.
 *
 * 기본 화면은 손만 표시한다. ?debug=1 또는 D 키로 입력·생성 결과를 함께 확인한다.
 */
export default function HandDisplay({ handState, recognitionState, latestSavedWord, serverOnline }: HandDisplayProps)
{
  const [searchParams, setSearchParams] = useSearchParams();
  const debug = searchParams.get('debug') === '1';
  const toggleDebug = (): void =>
  {
    setSearchParams((previous) =>
    {
      const next = new URLSearchParams(previous);
      if (next.get('debug') === '1') next.delete('debug');
      else next.set('debug', '1');
      return next;
    }, { replace: true });
  };
  useEffect(() =>
  {
    const onKeyDown = (event: KeyboardEvent): void =>
    {
      if (event.key.toLowerCase() !== 'd' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
      event.preventDefault();
      toggleDebug();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setSearchParams]);

  return (
    <div className={`hand-screen${debug ? ' hand-screen--debug' : ''}`}>
      <VirtualHand
        handState={handState}
        orientation={recognitionState.current.orientation}
        framing="portrait"
      />
      {debug && <HandDebugPanel recognitionState={recognitionState} latestSavedWord={latestSavedWord} serverOnline={serverOnline} onHide={toggleDebug} />}
      {!serverOnline && <div className="offline-banner">서버 연결이 끊겼다</div>}
    </div>
  );
}
