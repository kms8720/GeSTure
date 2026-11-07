import { useEffect, useState } from 'react';
import { NetworkInfo } from '../socket/types';

export default function ConnectionCheck({ serverOnline }: { serverOnline: boolean })
{
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [apiOk, setApiOk] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  useEffect(() =>
  {
    let active = true;
    const startedAt = performance.now();
    Promise.all([fetch('/health'), fetch('/network-info')]).then(async ([health, info]) =>
    {
      const data = await info.json();
      const status = await health.json();
      if (active)
      {
        setApiOk(health.ok && info.ok && status.ok === true);
        setNetwork(data); setLatency(Math.round(performance.now() - startedAt));
      }
    }).catch(() => { if (active) setApiOk(false); });
    return () => { active = false; };
  }, [serverOnline]);
  return (
    <main className="connection-check">
      <p>GESTURE · 연결 점검</p>
      <h1>{apiOk && serverOnline ? '이 휴대폰에서 참여할 수 있습니다' : '작품 연결을 확인해 주세요'}</h1>
      <ul aria-live="polite">
        <li>작품 서버: {apiOk ? '연결됨' : '연결 확인 중'}</li>
        <li>실시간 조종 연결: {serverOnline ? '연결됨' : '연결되지 않음'}</li>
        {latency !== null && <li>응답 시간: {latency}ms</li>}
      </ul>
      <p>Wi-Fi: {network?.wifiSsid || '운영자에게 문의해 주세요'}</p>
      <p>휴대폰의 Wi-Fi를 작품 네트워크로 연결해 주세요. 인터넷이 없다는 안내가 나와도 Wi-Fi 연결을 유지합니다.</p>
      <p>연결이 계속 끊기면 운영자에게 이 화면을 보여 주세요.</p>
      <a className="controller-primary" href="/join">참여하기</a>
      <button type="button" onClick={() => window.location.reload()}>다시 점검</button>
    </main>
  );
}
