import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { NetworkInfo, ParticipationSummary } from '../socket/types';

type JoinQrProps = {
  serverOnline: boolean;
  participationSummary: ParticipationSummary;
};

function escapeWifi(value: string): string
{
  return value.replace(/[\\;,:\"]/g, '\\$&');
}

export default function JoinQr({ serverOnline, participationSummary }: JoinQrProps)
{
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() =>
  {
    let active = true;
    fetch('/network-info').then((response) =>
    {
      if (!response.ok) throw new Error('접속 정보 없음');
      return response.json();
    }).then((next: NetworkInfo) =>
    {
      if (active) { setNetwork(next); setFailed(false); }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [serverOnline]);

  const wifiQr = network?.wifiSsid ?
    `WIFI:T:${network.wifiPassword ? 'WPA' : 'nopass'};S:${escapeWifi(network.wifiSsid)};P:${escapeWifi(network.wifiPassword)};;` : null;
  const readyToPrint = serverOnline && network?.configured && network.wifiSsid && network.joinUrl;

  return (
    <main className="join-qr-screen">
      <section className="join-qr-copy">
        <p className="join-qr-kicker">GESTURE · 낯선 공존</p>
        <h1>당신의 손가락을<br />손 하나에 더해 주세요</h1>
        <ol>
          <li>작품 Wi-Fi에 연결합니다.</li>
          <li>오른쪽 참여 QR을 휴대폰 카메라로 스캔합니다.</li>
          <li>배정된 손가락을 다른 사람들과 함께 움직입니다.</li>
        </ol>
        {network?.wifiSsid ? (
          <div className="join-qr-wifi">
            <strong>1 · Wi-Fi 연결</strong>
            <p>이름: {network.wifiSsid}</p>
            <p>{network.wifiPassword ? `비밀번호: ${network.wifiPassword}` : '비밀번호 없음'}</p>
            {wifiQr && <QRCodeSVG value={wifiQr} size={120} level="M" bgColor="#ffffff" fgColor="#050b12" title="Wi-Fi 연결 QR" />}
          </div>
        ) : <p>Wi-Fi 이름은 운영자에게 문의해 주세요.</p>}
        <p className="join-qr-count" aria-live="polite">
          지금 {participationSummary.connectedCount}명 참여 중
          {participationSummary.waitingCount > 0 && ` · ${participationSummary.waitingCount}명 대기 중`}
        </p>
        <a className="join-qr-no-print" href="/check">휴대폰 연결 점검</a>
        <button className="join-qr-no-print" type="button" disabled={!readyToPrint} onClick={() => window.print()}>안내판 인쇄</button>
      </section>
      <section className="join-qr-code" aria-label="참여 QR과 주소">
        <strong>2 · 참여하기</strong>
        {network?.joinUrl ? (
          <>
            <div className="join-qr-code__box">
              <QRCodeSVG value={network.joinUrl} size={320} bgColor="#ffffff" fgColor="#050b12" level="M" title="관객 참여 QR" />
            </div>
            <p>{network.joinUrl}</p>
          </>
        ) : <p role="status">{failed ? '접속 안내를 불러오지 못했습니다.' : network ? '참여 주소를 준비 중입니다.' : '참여 주소를 확인하고 있습니다.'}</p>}
        <span className={readyToPrint ? 'is-online' : 'is-offline'}>
          {!serverOnline ? '서버 연결 확인 필요' : readyToPrint ? 'Wi-Fi 연결 후 참여 QR을 스캔해 주세요' : '안내 정보 준비 중 · 운영자에게 문의해 주세요'}
        </span>
      </section>
    </main>
  );
}
