import { CSSProperties, KeyboardEvent, PointerEvent, useEffect, useRef, useState } from 'react';

type FingerSliderProps = {
  value: number;
  onChange: (value: number) => void;
};

export default function FingerSlider({ value, onChange }: FingerSliderProps)
{
  const rail = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const lastSent = useRef<number | null>(null);
  const [position, setPosition] = useState(value);
  const [dragging, setDragging] = useState(false);

  useEffect(() =>
  {
    if (pointer.current === null) setPosition(value);
  }, [value]);

  const send = (next: number, force = false): void =>
  {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    setPosition(clamped);
    if (force || lastSent.current !== clamped)
    {
      lastSent.current = clamped;
      onChange(clamped);
    }
  };

  const move = (clientY: number, force = false): void =>
  {
    const bounds = rail.current?.getBoundingClientRect();
    if (!bounds || bounds.height === 0) return;
    send((1 - (clientY - bounds.top) / bounds.height) * 100, force);
  };

  const start = (event: PointerEvent<HTMLDivElement>): void =>
  {
    if (!event.isPrimary || event.button !== 0 || pointer.current !== null) return;
    pointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    move(event.clientY, true);
  };

  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false): void =>
  {
    if (pointer.current !== event.pointerId) return;
    if (!cancelled) move(event.clientY, true);
    pointer.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
    {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>): void =>
  {
    let next: number;
    switch (event.key)
    {
      case 'ArrowUp': case 'ArrowRight': next = position + 1; break;
      case 'ArrowDown': case 'ArrowLeft': next = position - 1; break;
      case 'PageUp': next = position + 10; break;
      case 'PageDown': next = position - 10; break;
      case 'Home': next = 0; break;
      case 'End': next = 100; break;
      default: return;
    }
    event.preventDefault();
    send(next, true);
  };

  return (
    <div
      className={`controller-fader${dragging ? ' is-dragging' : ''}`}
      role="slider"
      tabIndex={0}
      aria-labelledby="controller-finger-name"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={position}
      aria-valuetext={position === 0 ? '접힘' : position === 100 ? '펴짐' : `${position}% 펴짐`}
      style={{ '--fader-position': `${100 - position}%`, '--fader-fill': `${position}%` } as CSSProperties}
      onPointerDown={start}
      onPointerMove={(event) => { if (pointer.current === event.pointerId) move(event.clientY); }}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) =>
      {
        if (pointer.current === event.pointerId)
        {
          pointer.current = null;
          setDragging(false);
        }
      }}
      onKeyDown={keyDown}
    >
      <div ref={rail} className="controller-fader__rail" aria-hidden="true">
        <div className="controller-fader__fill" />
        <div className="controller-fader__handle"><span className="controller-fader__grip" /></div>
      </div>
    </div>
  );
}
