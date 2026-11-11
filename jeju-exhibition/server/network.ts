import os from 'node:os';

export function getLanAddresses(): string[]
{
  return [...new Set(Object.entries(os.networkInterfaces())
    .filter(([name]) => !/^(utun|tun|tap|vmnet|vbox)/i.test(name))
    .flatMap(([, entries]) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
    .map((entry) => entry.address))];
}

export function validatePublicOrigin(value: string): string
{
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/' ||
      ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname) ||
      url.hostname.startsWith('127.'))
  {
    throw new Error('PUBLIC_ORIGIN에는 휴대폰이 접속할 서버 주소만 넣어 주세요. 예: http://192.168.50.10:3002');
  }
  return url.origin;
}

export function networkInfo(port: number, configuredOrigin: string | undefined, requestHostname?: string,
  addresses = getLanAddresses(), connectionMode = process.env.CONNECTION_MODE ?? 'lan')
{
  validateConnectionMode(connectionMode, configuredOrigin);
  const internet = connectionMode === 'internet';
  const selected = requestHostname && addresses.includes(requestHostname) ? requestHostname :
    addresses.length === 1 ? addresses[0] : null;
  const publicOrigin = configuredOrigin ? validatePublicOrigin(configuredOrigin) :
    selected ? `http://${selected}:${port}` : null;
  return {
    port, addresses: internet ? [] : addresses, publicOrigin, connectionMode,
    joinUrl: internet && process.env.JOIN_ENTRY_URL ? validateJoinEntryUrl(process.env.JOIN_ENTRY_URL) : publicOrigin ? `${publicOrigin}/join` : null,
    checkUrl: publicOrigin ? `${publicOrigin}/check` : null,
    configured: Boolean(configuredOrigin),
    wifiSsid: internet ? '' : process.env.WIFI_SSID ?? '',
    wifiPassword: internet ? '' : process.env.WIFI_PASSWORD ?? '',
    warning: !publicOrigin ? '여러 네트워크가 있거나 LAN 주소가 없습니다. PUBLIC_ORIGIN을 설정해 주세요.' :
      !configuredOrigin ? '자동 감지 주소입니다. 전시 전 서버 IP를 고정하고 PUBLIC_ORIGIN을 설정해 주세요.' : ''
  };
}

export function validateConnectionMode(mode: string, origin?: string): void
{
  if (!['lan', 'internet'].includes(mode)) throw new Error('CONNECTION_MODE는 lan 또는 internet이어야 합니다.');
  if (mode === 'internet' && (!origin || !validatePublicOrigin(origin).startsWith('https://')))
    throw new Error('인터넷 참여에는 PUBLIC_ORIGIN에 공개 HTTPS 주소가 필요합니다.');
}

export function validateJoinEntryUrl(value: string): string
{
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !url.hostname.endsWith('.github.io')) throw new Error('JOIN_ENTRY_URL에는 GitHub Pages의 HTTPS 입구 주소를 넣어 주세요.');
  return url.href;
}
