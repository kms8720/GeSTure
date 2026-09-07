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
  socketId: string | null;
  reconnectDeadline: number | null;
};

export type JoinResult = {
  state: ParticipantState;
  replacedSocketId: string | null;
};

export type ReleaseResult = {
  releasedFinger: Finger | null;
  promotedToken: string | null;
};

export class ParticipantSessions
{
  private readonly sessions = new Map<string, ParticipantSession>();
  private readonly fingerOwners = new Map<Finger, string>();
  private readonly waitingTokens: string[] = [];

  public join(token: string, socketId: string): JoinResult
  {
    const existing = this.sessions.get(token);
    let replacedSocketId: string | null = null;

    if (existing)
    {
      if (existing.socketId && existing.socketId !== socketId)
      {
        replacedSocketId = existing.socketId;
      }
      existing.socketId = socketId;
      existing.reconnectDeadline = null;

      if (!existing.finger)
      {
        const freeFinger = FINGERS.find((finger) => !this.fingerOwners.has(finger));
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

      return { state: this.getState(token), replacedSocketId };
    }

    const freeFinger = FINGERS.find((finger) => !this.fingerOwners.has(finger)) ?? null;
    const session: ParticipantSession = {
      token,
      finger: freeFinger,
      socketId,
      reconnectDeadline: null
    };
    this.sessions.set(token, session);

    if (freeFinger)
    {
      this.fingerOwners.set(freeFinger, token);
    }
    else
    {
      this.waitingTokens.push(token);
    }

    return { state: this.getState(token), replacedSocketId };
  }

  public disconnect(socketId: string, now = Date.now()): void
  {
    const session = Array.from(this.sessions.values()).find((entry) => entry.socketId === socketId);
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
    return session?.socketId === socketId ? session.finger : null;
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

    const queueIndex = this.waitingTokens.indexOf(token);
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

  private promote(finger: Finger): string | null
  {
    const index = this.waitingTokens.findIndex((token) => this.sessions.get(token)?.socketId !== null);
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
