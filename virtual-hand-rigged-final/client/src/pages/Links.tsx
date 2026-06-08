import { QRCodeSVG } from 'qrcode.react';
import { Link } from 'react-router-dom';
import { FINGER_LABELS, FINGER_ORDER } from '../socket/types';

type LinksProps = {
  serverOnline: boolean;
};

function getBaseUrl(): string
{
  return window.location.origin;
}

export default function Links({ serverOnline }: LinksProps)
{
  const baseUrl = getBaseUrl();
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  return (
    <main className="links-screen">
      <div className="links-shell">
        <header className="links-header">
          <div>
            <p className="eyebrow">CONTROLLER ACCESS</p>
            <h1>손가락 조종 링크</h1>
            <p>관객은 각자 다른 QR을 스캔해서 손가락 하나만 조종한다.</p>
          </div>
          <div className="links-header__actions">
            <Link className="hud-pill" to="/display">DISPLAY</Link>
            <Link className="hud-pill" to="/recognition">RECOGNITION</Link>
          </div>
        </header>

        {isLocalhost && (
          <section className="network-warning glass-card">
            현재 <strong>localhost</strong>로 열려 있다. 휴대폰 QR 접속을 하려면 노트북 IP로 다시 열어야 한다.
            <code>http://노트북_IP:3001/links</code>
          </section>
        )}

        <section className="server-mini glass-card">
          <span className={serverOnline ? 'server-dot is-online' : 'server-dot is-offline'} />
          {serverOnline ? 'Socket server online' : 'Socket server offline'}
        </section>

        <section className="links-grid">
          {FINGER_ORDER.map((finger) => {
            const url = `${baseUrl}/control/${finger}`;

            return (
              <article key={finger} className="link-card glass-card">
                <div className="qr-box">
                  <QRCodeSVG value={url} size={164} bgColor="transparent" fgColor="#eaf7ff" />
                </div>
                <div className="link-card__body">
                  <strong>{FINGER_LABELS[finger]}</strong>
                  <span>{url}</span>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
