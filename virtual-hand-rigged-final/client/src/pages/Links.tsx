import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FINGER_LABELS, FINGER_ORDER } from '../socket/types';

type LinksProps = {
  serverOnline: boolean;
};

function getBaseUrl(): string
{
  return window.location.origin;
}

function isLocalhostAddress(hostname: string): boolean
{
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export default function Links({ serverOnline }: LinksProps)
{
  const currentBaseUrl = getBaseUrl();
  const [controllerBaseUrl, setControllerBaseUrl] = useState(currentBaseUrl);
  const isLocalhost = isLocalhostAddress(window.location.hostname);

  useEffect(() =>
  {
    let ignore = false;

    async function loadNetworkInfo(): Promise<void>
    {
      try
      {
        const response = await fetch('/network-info');
        const networkInfo = await response.json() as { preferredOrigin?: string | null };

        if (!ignore && networkInfo.preferredOrigin && isLocalhost)
        {
          setControllerBaseUrl(networkInfo.preferredOrigin);
        }
      }
      catch
      {
        if (!ignore)
        {
          setControllerBaseUrl(currentBaseUrl);
        }
      }
    }

    loadNetworkInfo();

    return () =>
    {
      ignore = true;
    };
  }, [currentBaseUrl, isLocalhost]);

  const linksUrl = `${controllerBaseUrl}/links`;

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
            현재 창은 <strong>localhost</strong>로 열려 있다. QR은 휴대폰 접속을 위해 노트북 IP 주소로 생성된다.
            <code>{linksUrl}</code>
          </section>
        )}

        {!isLocalhost && (
          <section className="network-warning is-ready glass-card">
            QR 접속 주소
            <code>{linksUrl}</code>
          </section>
        )}

        <section className="server-mini glass-card">
          <span className={serverOnline ? 'server-dot is-online' : 'server-dot is-offline'} />
          {serverOnline ? 'Socket server online' : 'Socket server offline'}
        </section>

        <section className="links-grid">
          {FINGER_ORDER.map((finger) => {
            const url = `${controllerBaseUrl}/control/${finger}`;

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
