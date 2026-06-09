import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Display from './pages/Display';
import Controller from './pages/Controller';
import Links from './pages/Links';
import Recognition from './pages/Recognition';
import { socket } from './socket/socket';
import {
  ControllerState,
  HandState,
  INITIAL_CONTROLLER_STATE,
  INITIAL_HAND_STATE,
  INITIAL_RECOGNITION_STATE,
  RecognitionState
} from './socket/types';

export default function App()
{
  const [handState, setHandState] = useState<HandState>(INITIAL_HAND_STATE);
  const [controllerState, setControllerState] = useState<ControllerState>(INITIAL_CONTROLLER_STATE);
  const [connectedCount, setConnectedCount] = useState(0);
  const [recognitionState, setRecognitionState] = useState<RecognitionState>(INITIAL_RECOGNITION_STATE);
  const [serverOnline, setServerOnline] = useState(socket.connected);

  useEffect(() =>
  {
    const handleConnect = () =>
    {
      setServerOnline(true);
    };

    const handleDisconnect = () =>
    {
      setServerOnline(false);
    };

    const handleHandState = (nextState: HandState) =>
    {
      setHandState(nextState);
    };

    const handleControllerState = (nextState: ControllerState) =>
    {
      setControllerState(nextState);
    };

    const handleControllerCount = (count: number) =>
    {
      setConnectedCount(count);
    };

    const handleRecognitionState = (nextState: RecognitionState) =>
    {
      setRecognitionState(nextState);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('hand:state', handleHandState);
    socket.on('controller:state', handleControllerState);
    socket.on('controller:count', handleControllerCount);
    socket.on('recognition:state', handleRecognitionState);
    setServerOnline(socket.connected);

    if (!socket.connected)
    {
      socket.connect();
    }

    return () =>
    {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('hand:state', handleHandState);
      socket.off('controller:state', handleControllerState);
      socket.off('controller:count', handleControllerCount);
      socket.off('recognition:state', handleRecognitionState);
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Display
              handState={handState}
              controllerState={controllerState}
              connectedCount={connectedCount}
              serverOnline={serverOnline}
              recognitionState={recognitionState}
            />
          }
        />
        <Route
          path="/display"
          element={
            <Display
              handState={handState}
              controllerState={controllerState}
              connectedCount={connectedCount}
              serverOnline={serverOnline}
              recognitionState={recognitionState}
            />
          }
        />
        <Route path="/control/:finger" element={<Controller handState={handState} serverOnline={serverOnline} />} />
        <Route path="/links" element={<Links serverOnline={serverOnline} />} />
        <Route path="/recognition" element={<Recognition recognitionState={recognitionState} serverOnline={serverOnline} />} />
        <Route path="*" element={<Navigate to="/display" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
