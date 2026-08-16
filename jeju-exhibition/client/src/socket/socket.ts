import { io } from 'socket.io-client';

const DEFAULT_PORT = '3002';

function getSocketUrl(): string
{
  const explicitUrl = import.meta.env.VITE_SOCKET_URL as string | undefined;

  if (explicitUrl)
  {
    return explicitUrl;
  }

  const { protocol, hostname, port, origin } = window.location;

  // 빌드된 화면은 서버가 직접 서빙하므로 같은 origin을 쓴다
  if (port === DEFAULT_PORT)
  {
    return origin;
  }

  // vite dev 서버(5174)에서 열었을 때는 API 포트로 붙는다
  return `${protocol}//${hostname}:${DEFAULT_PORT}`;
}

export const socket = io(getSocketUrl(), {
  autoConnect: true,
  transports: ['websocket', 'polling']
});
