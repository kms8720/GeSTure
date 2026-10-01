import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { ControllerState, FINGER_LABELS, FINGER_ORDER, NetworkInfo, ParticipationSummary } from '../socket/types';

type JoinQrProps = {
  serverOnline: boolean;
  participationSummary: ParticipationSummary;
  controllerState: ControllerState;
};

export default function JoinQr({ serverOnline, participationSummary, controllerState }: JoinQrProps)
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

  const readyToPrint = serverOnline && network?.configured && network.wifiSsid && network.joinUrl;

  return (
    <main className="join-qr-screen">
      <header className="join-qr-header">
        <p className="join-qr-kicker">GESTURE · 낯선 공존</p>
        <h1>함께 움직이는 다섯 손가락</h1>
        <p>Wi-Fi에 연결한 뒤, 움직이고 싶은 손가락의 QR을 스캔해 주세요.</p>
        {network?.wifiSsid ? (
          <div className="join-qr-wifi">
            <span>Wi-Fi · {network.wifiSsid}</span>
            {network.wifiPassword && <span>비밀번호 · {network.wifiPassword}</span>}
          </div>
        ) : <p className="join-qr-network-note">노트북과 같은 Wi-Fi에서 참여합니다.</p>}
      </header>
      {network?.joinUrl ? (
        <section className="join-qr-grid" aria-label="손가락별 참여 QR">
          {FINGER_ORDER.map((finger) =>
          {
            const joinUrl = `${network.joinUrl}?finger=${finger}`;
            const label = FINGER_LABELS[finger];
            const status = controllerState[finger].status;
            return (
              <a key={finger} className={`join-qr-card join-qr-card--${finger}`} href={joinUrl} aria-label={`${label} 조종하기`}>
                <h2>{label}</h2>
                <div className="join-qr-code__box">
                  <QRCodeSVG value={joinUrl} size={208} marginSize={4} bgColor="#ffffff" fgColor="#050b12" level="M" title={`${label} 참여 QR`} />
                </div>
                <span className="join-qr-card__status">
                  {!serverOnline ? '연결 확인 중' : status === 'available' ? '참여 가능' : status === 'reconnecting' ? '재연결 중 · 대기' : '사용 중 · 대기'}
                </span>
              </a>
            );
          })}
        </section>
      ) : <p role="status">{failed ? '접속 안내를 불러오지 못했습니다.' : network ? '참여 주소를 준비 중입니다.' : '참여 주소를 확인하고 있습니다.'}</p>}
      <footer className="join-qr-footer">
        <p>사용 중인 손가락을 선택하면 그 손가락의 차례를 기다립니다.</p>
        <p className="join-qr-count" aria-live="polite">
          지금 {participationSummary.connectedCount}명 참여 중
          {participationSummary.waitingCount > 0 && ` · ${participationSummary.waitingCount}명 대기 중`}
        </p>
        <a className="join-qr-no-print" href="/check">휴대폰 연결 점검</a>
        <button className="join-qr-no-print" type="button" disabled={!readyToPrint} onClick={() => window.print()}>안내판 인쇄</button>
        {!serverOnline && <p role="status">작품 연결을 확인하고 있습니다.</p>}
      </footer>
    </main>
  );
}
