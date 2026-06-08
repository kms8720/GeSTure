import { io } from 'socket.io-client';

function getSocketUrl(): string
{
  const explicitUrl = import.meta.env.VITE_SOCKET_URL as string | undefined;

  if (explicitUrl)
  {
    return explicitUrl;
  }

  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const currentPort = window.location.port;

  if (currentPort === '3001')
  {
    return window.location.origin;
  }

  return `${protocol}//${hostname}:3001`;
}

export const socket = io(getSocketUrl(), {
  autoConnect: true,
  transports: ['websocket', 'polling']
});
