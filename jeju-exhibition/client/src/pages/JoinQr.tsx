import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { ParticipationSummary } from '../socket/types';

type JoinQrProps = {
  serverOnline: boolean;
  participationSummary: ParticipationSummary;
};

function isLoopback(hostname: string): boolean
{
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export default function JoinQr({ serverOnline, participationSummary }: JoinQrProps)
{
  const [joinUrl, setJoinUrl] = useState(`${window.location.origin}/join`);

  useEffect(() =>
  {
    if (!isLoopback(window.location.hostname))
    {
      return;
    }

    let active = true;
    fetch('/network-info')
      .then((response) => response.json())
      .then((network: { preferredOrigin?: string | null }) =>
      {
        if (active && network.preferredOrigin)
        {
          setJoinUrl(`${network.preferredOrigin}/join`);
        }
      })
      .catch(() => undefined);

    return () =>
    {
      active = false;
    };
  }, []);

  return (
    <main className="join-qr-screen">
      <section className="join-qr-copy">
        <p className="join-qr-kicker">GESTURE · 낯선 공존</p>
        <h1>당신의 손가락을<br />손 하나에 더해 주세요</h1>
        <ol>
          <li>작품 Wi-Fi에 연결합니다.</li>
          <li>QR을 휴대폰 카메라로 스캔합니다.</li>
          <li>배정된 손가락을 다른 네 사람과 함께 움직입니다.</li>
        </ol>
        <p className="join-qr-count" aria-live="polite">
          지금 {participationSummary.connectedCount}명 참여 중
          {participationSummary.waitingCount > 0 && ` · ${participationSummary.waitingCount}명 대기 중`}
        </p>
      </section>

      <section className="join-qr-code" aria-label={`참여 주소 ${joinUrl}`}>
        <div className="join-qr-code__box">
          <QRCodeSVG value={joinUrl} size={320} bgColor="#ffffff" fgColor="#050b12" level="M" />
        </div>
        <p>{joinUrl}</p>
        <span className={serverOnline ? 'is-online' : 'is-offline'}>
          {serverOnline ? '참여 연결 준비됨' : '서버 연결 확인 필요'}
        </span>
      </section>
    </main>
  );
}
