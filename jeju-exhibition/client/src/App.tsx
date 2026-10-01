import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Controller from './pages/Controller';
import ConnectionCheck from './pages/ConnectionCheck';
import HandDisplay from './pages/HandDisplay';
import JoinQr from './pages/JoinQr';
import Monitor from './pages/Monitor';
import WordDisplay from './pages/WordDisplay';
import { socket } from './socket/socket';
import {
  ControllerState,
  HandState,
  INITIAL_CONTROLLER_STATE,
  INITIAL_HAND_STATE,
  INITIAL_PARTICIPATION_SUMMARY,
  INITIAL_RECOGNITION_STATE,
  ParticipationSummary,
  PoseClass,
  RecognitionState
} from './socket/types';

export default function App()
{
  const [handState, setHandState] = useState<HandState>(INITIAL_HAND_STATE);
  const [controllerState, setControllerState] = useState<ControllerState>(INITIAL_CONTROLLER_STATE);
  const [participationSummary, setParticipationSummary] = useState<ParticipationSummary>(INITIAL_PARTICIPATION_SUMMARY);
  const [recognitionState, setRecognitionState] = useState<RecognitionState>(INITIAL_RECOGNITION_STATE);
  const [poseClasses, setPoseClasses] = useState<PoseClass[]>([]);
  const [serverOnline, setServerOnline] = useState(socket.connected);

  useEffect(() =>
  {
    const onConnect = () => setServerOnline(true);
    const onDisconnect = () => setServerOnline(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('hand:state', setHandState);
    socket.on('controller:state', setControllerState);
    socket.on('participation:summary', setParticipationSummary);
    socket.on('recognition:state', setRecognitionState);
    socket.on('pose:classes', setPoseClasses);
    setServerOnline(socket.connected);

    if (!socket.connected)
    {
      socket.connect();
    }

    return () =>
    {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('hand:state', setHandState);
      socket.off('controller:state', setControllerState);
      socket.off('participation:summary', setParticipationSummary);
      socket.off('recognition:state', setRecognitionState);
      socket.off('pose:classes', setPoseClasses);
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        {/* 손 화면과 단어 화면은 서로 다른 디스플레이에 띄운다 */}
        <Route
          path="/display/hand"
          element={
            <HandDisplay
              handState={handState}
              recognitionState={recognitionState}
              serverOnline={serverOnline}
            />
          }
        />
        <Route
          path="/display/word"
          element={<WordDisplay recognitionState={recognitionState} serverOnline={serverOnline} />}
        />
        <Route path="/display" element={<Navigate to="/display/hand" replace />} />
        <Route path="/join" element={<Controller handState={handState} serverOnline={serverOnline} />} />
        <Route path="/check" element={<ConnectionCheck serverOnline={serverOnline} />} />
        <Route
          path="/join/qr"
          element={<JoinQr serverOnline={serverOnline} participationSummary={participationSummary} />}
        />
        <Route path="/control/:finger" element={<Navigate to="/join" replace />} />
        <Route
          path="/monitor"
          element={
            <Monitor
              handState={handState}
              controllerState={controllerState}
              participationSummary={participationSummary}
              recognitionState={recognitionState}
              poseClasses={poseClasses}
              serverOnline={serverOnline}
            />
          }
        />
        <Route path="*" element={<Navigate to="/display" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
