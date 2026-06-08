import { ControllerState, FINGER_LABELS, FINGER_ORDER, HandState } from '../socket/types';

type ConnectionStatusProps = {
  controllerState: ControllerState;
  handState: HandState;
  connectedCount: number;
};

export default function ConnectionStatus({ controllerState, handState, connectedCount }: ConnectionStatusProps)
{
  return (
    <aside className="status-panel glass-card">
      <div className="status-panel__head">
        <span>CONNECTED BODIES</span>
        <strong>{connectedCount}</strong>
      </div>

      <ul className="status-list">
        {FINGER_ORDER.map((finger) => (
          <li key={finger} className="status-list__item">
            <div className="status-list__label">
              <strong>{FINGER_LABELS[finger]}</strong>
              <span className={controllerState[finger] ? 'status-badge is-online' : 'status-badge is-waiting'}>
                {controllerState[finger] ? 'CONNECTED' : 'WAITING'}
              </span>
            </div>
            <div className="status-list__value">{handState[finger]}</div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
