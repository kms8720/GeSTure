import { FINGERS, Finger } from './poseClasses.js';

export const PARTICIPANT_RECONNECT_GRACE_MS = 15_000;

export type ControllerSlotStatus = 'available' | 'connected' | 'reconnecting';

export type ControllerSlotState = {
  status: ControllerSlotStatus;
  reconnectDeadline: string | null;
};

export type ParticipationSummary = {
  connectedCount: number;
  occupiedCount: number;
  waitingCount: number;
};

export type ParticipantState = {
  status: 'assigned' | 'waiting' | 'released';
  finger: Finger | null;
  queuePosition: number | null;
  summary: ParticipationSummary;
};

type ParticipantSession = {
  token: string;
  finger: Finger | null;
  requestedFinger: Finger | null;
  socketId: string | null;
  reconnectDeadline: number | null;
};

export type JoinResult = {
  state: ParticipantState;
  replacedSocketId: string | null;
  releasedFinger: Finger | null;
};

export type ReleaseResult = {
  releasedFinger: Finger | null;
  promotedToken: string | null;
};

export class ParticipantSessions
{
  private readonly sessions = new Map<string, ParticipantSession>();
  private readonly socketTokens = new Map<string, string>();
  private readonly fingerOwners = new Map<Finger, string>();
  private readonly waitingTokens: string[] = [];

  public join(token: string, socketId: string, requestedFinger?: Finger): JoinResult
  {
    const boundToken = this.socketTokens.get(socketId);
    if (boundToken && boundToken !== token)
    {
      throw new Error('이미 참여 중인 연결입니다. 참여를 마친 뒤 다시 접속해 주세요.');
    }
    let existing = this.sessions.get(token);
    const preferred = requestedFinger ?? existing?.requestedFinger ?? null;
    let replacedSocketId = existing?.socketId && existing.socketId !== socketId ? existing.socketId : null;
    let releasedFinger: Finger | null = null;

    // 같은 참여자가 다른 QR을 선택하면 이전 손가락을 반환한 뒤 이동한다.
    if (existing && preferred && existing.finger !== preferred && existing.requestedFinger !== preferred)
    {
      if (existing.finger && this.fingerOwners.has(preferred) && this.waitingTokens.length >= 128)
      {
        throw new Error('대기 인원이 많아 지금은 손가락을 변경할 수 없습니다.');
      }
      releasedFinger = this.release(token).releasedFinger;
      existing = undefined;
    }

    if (existing)
    {
      if (existing.socketId && existing.socketId !== socketId)
      {
        replacedSocketId = existing.socketId;
        this.socketTokens.delete(existing.socketId);
      }
      existing.socketId = socketId;
      existing.reconnectDeadline = null;
      existing.requestedFinger = preferred;
      this.socketTokens.set(socketId, token);

      if (!existing.finger)
      {
        const freeFinger = this.freeFinger(preferred);
        if (freeFinger)
        {
          const waitingIndex = this.waitingTokens.indexOf(token);
          if (waitingIndex >= 0)
          {
            this.waitingTokens.splice(waitingIndex, 1);
          }
          existing.finger = freeFinger;
          this.fingerOwners.set(freeFinger, token);
        }
      }

      return { state: this.getState(token), replacedSocketId, releasedFinger };
    }

    const freeFinger = this.freeFinger(preferred);
    if (!freeFinger && this.waitingTokens.length >= 128)
    {
      throw new Error('현재 대기 인원이 많습니다. 잠시 후 다시 참여해 주세요.');
    }
    const session: ParticipantSession = {
      token,
      finger: freeFinger,
      requestedFinger: preferred,
      socketId,
      reconnectDeadline: null
    };
    this.sessions.set(token, session);
    this.socketTokens.set(socketId, token);

    if (freeFinger)
    {
      this.fingerOwners.set(freeFinger, token);
    }
    else
    {
      this.waitingTokens.push(token);
    }

    return { state: this.getState(token), replacedSocketId, releasedFinger };
  }

  public disconnect(socketId: string, now = Date.now()): void
  {
    const token = this.socketTokens.get(socketId);
    const session = token ? this.sessions.get(token) : undefined;
    this.socketTokens.delete(socketId);
    if (!session)
    {
      return;
    }

    session.socketId = null;
    session.reconnectDeadline = now + PARTICIPANT_RECONNECT_GRACE_MS;
  }

  public expire(now = Date.now()): ReleaseResult[]
  {
    return Array.from(this.sessions.values())
      .filter((session) => session.reconnectDeadline !== null && session.reconnectDeadline <= now)
      .map((session) => this.release(session.token));
  }

  public release(token: string): ReleaseResult
  {
    const session = this.sessions.get(token);
    if (!session)
    {
      return { releasedFinger: null, promotedToken: null };
    }

    this.sessions.delete(token);
    if (session.socketId) this.socketTokens.delete(session.socketId);
    const waitingIndex = this.waitingTokens.indexOf(token);
    if (waitingIndex >= 0)
    {
      this.waitingTokens.splice(waitingIndex, 1);
    }

    if (!session.finger)
    {
      return { releasedFinger: null, promotedToken: null };
    }

    this.fingerOwners.delete(session.finger);
    const promotedToken = this.promote(session.finger);
    return { releasedFinger: session.finger, promotedToken };
  }

  public releaseFinger(finger: Finger): ReleaseResult
  {
    const token = this.fingerOwners.get(finger);
    return token ? this.release(token) : { releasedFinger: null, promotedToken: null };
  }

  public getAssignedFinger(token: string, socketId: string): Finger | null
  {
    const session = this.sessions.get(token);
    return this.socketTokens.get(socketId) === token && session?.socketId === socketId ? session.finger : null;
  }

  public getState(token: string): ParticipantState
  {
    const session = this.sessions.get(token);
    const summary = this.getSummary();

    if (!session)
    {
      return { status: 'released', finger: null, queuePosition: null, summary };
    }

    if (session.finger)
    {
      return { status: 'assigned', finger: session.finger, queuePosition: null, summary };
    }

    const eligibleQueue = session.requestedFinger
      ? this.waitingTokens.filter((waitingToken) =>
        {
          const waiting = this.sessions.get(waitingToken);
          return !waiting?.requestedFinger || waiting.requestedFinger === session.requestedFinger;
        })
      : this.waitingTokens;
    const queueIndex = eligibleQueue.indexOf(token);
    return {
      status: 'waiting',
      finger: null,
      queuePosition: queueIndex >= 0 ? queueIndex + 1 : null,
      summary
    };
  }

  public getControllerState(now = Date.now()): Record<Finger, ControllerSlotState>
  {
    return Object.fromEntries(FINGERS.map((finger) =>
    {
      const token = this.fingerOwners.get(finger);
      const session = token ? this.sessions.get(token) : undefined;
      if (!session)
      {
        return [finger, { status: 'available', reconnectDeadline: null }];
      }

      if (session.socketId)
      {
        return [finger, { status: 'connected', reconnectDeadline: null }];
      }

      const deadline = session.reconnectDeadline ?? now;
      return [finger, {
        status: 'reconnecting',
        reconnectDeadline: new Date(deadline).toISOString()
      }];
    })) as Record<Finger, ControllerSlotState>;
  }

  public getSummary(): ParticipationSummary
  {
    const assigned = Array.from(this.sessions.values()).filter((session) => session.finger !== null);
    return {
      connectedCount: assigned.filter((session) => session.socketId !== null).length,
      occupiedCount: assigned.length,
      waitingCount: this.waitingTokens.length
    };
  }

  private freeFinger(preferred: Finger | null): Finger | null
  {
    if (preferred) return this.fingerOwners.has(preferred) ? null : preferred;
    return FINGERS.find((finger) => !this.fingerOwners.has(finger)) ?? null;
  }

  private promote(finger: Finger): string | null
  {
    const index = this.waitingTokens.findIndex((token) =>
    {
      const session = this.sessions.get(token);
      return session?.socketId && (!session.requestedFinger || session.requestedFinger === finger);
    });
    if (index < 0)
    {
      return null;
    }

    const [token] = this.waitingTokens.splice(index, 1);
    const session = this.sessions.get(token);
    if (!session)
    {
      return null;
    }

    session.finger = finger;
    this.fingerOwners.set(finger, token);
    return token;
  }
}
