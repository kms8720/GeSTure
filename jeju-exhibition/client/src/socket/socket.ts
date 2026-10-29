import { io } from 'socket.io-client';

function getSocketUrl(): string
{
  const explicitUrl = import.meta.env.VITE_SOCKET_URL as string | undefined;

  if (explicitUrl)
  {
    return explicitUrl;
  }

  return window.location.origin;
}

export const socket = io(getSocketUrl(), {
  autoConnect: false,
  transports: ['websocket', 'polling']
});
