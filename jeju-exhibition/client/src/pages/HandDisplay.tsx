import VirtualHand from '../components/VirtualHand';
import { HandState, RecognitionState } from '../socket/types';

type HandDisplayProps = {
  handState: HandState;
  recognitionState: RecognitionState;
  serverOnline: boolean;
};

/**
 * 손만 보이는 화면. 세로로 세운 디스플레이 한 대를 통째로 쓴다.
 *
 * 자모 후보, 슬롯 진행, 단어는 전부 /display/word 로 옮겼다.
 * 손을 가능한 한 크게 보여주는 것이 이 화면의 유일한 목적이라
 * 관객에게 보이는 요소를 여기 더 붙이지 않는다.
 *
 * 서버가 끊겼을 때만 배너가 뜬다. 평소에는 아무것도 없다.
 */
export default function HandDisplay({ handState, recognitionState, serverOnline }: HandDisplayProps)
{
  return (
    <div className="hand-screen">
      <VirtualHand
        handState={handState}
        orientation={recognitionState.current.orientation}
        framing="portrait"
      />
      {!serverOnline && <div className="offline-banner">서버 연결이 끊겼다</div>}
    </div>
  );
}
